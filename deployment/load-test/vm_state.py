"""VM-owned, fail-closed attempt ledger for manually dispatched k6 runs."""

import argparse
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import time
import uuid

from vm_control import checked_database_url

RUN_ID = re.compile(r"load-[0-9]{8}-[a-z0-9]{8,32}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
MAX_PROFILE_BYTES = 4096
MAX_SMOKE_AGE_SECONDS = 30 * 60
SOURCE_RUN_ID = re.compile(r"[0-9]{6,30}\Z")
PROJECT_REF = re.compile(r"[a-z0-9]{20}\Z")
DATABASE_HOST = re.compile(r"[a-z0-9.-]+\.supabase\.com\Z")


def private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Load-test state directory must be owner-only")


def read_profile(path):
    data = path.read_bytes()
    if not data or len(data) > MAX_PROFILE_BYTES:
        raise ValueError("Profile file is empty or too large")
    profile = json.loads(data)
    if set(profile) != {"maxVus", "stageMinutes", "stageTargets", "rampWriteAttempts"}:
        raise ValueError("Profile fields are invalid")
    vus = profile["maxVus"]
    minutes = profile["stageMinutes"]
    attempts = profile["rampWriteAttempts"]
    if (type(vus) is not int or not 1 <= vus <= 20 or
            type(attempts) is not int or not 6 <= attempts <= 17 or
            not isinstance(minutes, list) or len(minutes) != 4 or
            any(type(n) is not int or n < 1 for n in minutes) or sum(minutes) > 10 or
            profile["stageTargets"] != [min(n, vus) for n in (1, 5, 10, 20)]):
        raise ValueError("Profile exceeds hard limits")
    canonical = json.dumps(profile, separators=(",", ":")).encode()
    return profile, hashlib.sha256(canonical).hexdigest()


def read_state(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Attempt state is not an owner-only regular file")
    data = path.read_bytes()
    if len(data) > MAX_PROFILE_BYTES:
        raise ValueError("Attempt state is oversized")
    state = json.loads(data)
    if not isinstance(state, dict) or state.get("status") not in {"smoke-claimed", "smoke-verified", "ramp-claimed", "cleaned"}:
        raise ValueError("Attempt state is invalid")
    return state


def persist(path, state, new=False):
    contents = (json.dumps(state, separators=(",", ":")) + "\n").encode()
    if new:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, contents)
            os.fsync(fd)
        finally:
            os.close(fd)
    else:
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, contents)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def present(path):
    return os.path.lexists(path)


def private_bytes(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > limit:
        raise ValueError("Fixture identity file must be an owner-only bounded regular file")
    return path.read_bytes()


def scan_states(root):
    states = {}
    for path in root.iterdir():
        if not path.name.endswith(".state.json"):
            continue
        run_id = path.name[:-len(".state.json")]
        if not RUN_ID.fullmatch(run_id):
            raise ValueError("Unknown load-test attempt state")
        state = read_state(path)
        if (state.get("runId") != run_id or not SHA.fullmatch(state.get("deployedSha", ""))
                or not isinstance(state.get("profile"), dict)
                or not re.fullmatch(r"[0-9a-f]{64}", state.get("profileFingerprint", ""))
                or type(state.get("claimedAt")) is not int):
            raise ValueError("Attempt state identity is malformed")
        canonical = json.dumps(state["profile"], separators=(",", ":")).encode()
        if hashlib.sha256(canonical).hexdigest() != state["profileFingerprint"]:
            raise ValueError("Attempt profile fingerprint is malformed")
        if state["status"] == "cleaned":
            if type(state.get("cleanedAt")) is not int or present(root / f"{run_id}.json") or present(root / f"{run_id}.db-url"):
                raise ValueError("Cleaned attempt has unresolved fixture files")
        states[run_id] = state
    for path in root.iterdir():
        name = path.name
        if name.endswith(".state.json") or name.endswith(".profile.json"):
            continue
        if name.endswith(".db-url"):
            run_id = name[:-len(".db-url")]
        elif name.endswith(".json"):
            run_id = name[:-len(".json")]
        else:
            continue
        if run_id.startswith("load-") and (not RUN_ID.fullmatch(run_id) or run_id not in states):
            raise ValueError("Orphan or malformed fixture file requires review")
    return states


def source_url(source_run_id):
    return f"https://github.com/drh-14/ChalkTalk/actions/runs/{source_run_id}"


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def manifest_matches(manifest, run_id, sha, project_ref, database_host):
    if not isinstance(manifest, dict) or any((
            manifest.get("runId") != run_id,
            manifest.get("deployedSha") != sha,
            manifest.get("baseUrl") != "https://joinchalktalk.com",
            manifest.get("expectedProjectRef") != project_ref,
            manifest.get("expectedHost") != database_host)):
        return False
    if not all(valid_uuid(manifest.get(key)) for key in
               ("organizationId", "courseId", "questionId", "pollId", "pollOptionId")):
        return False
    users = manifest.get("users")
    if not isinstance(users, list) or len(users) != 20:
        return False
    for index, user in enumerate(users, 1):
        if (not isinstance(user, dict) or not valid_uuid(user.get("id"))
                or user.get("email") != f"vu{index:02d}@{run_id}.loadtest.invalid"
                or not isinstance(user.get("password"), str) or not user["password"]):
            return False
    return len({user["id"] for user in users}) == 20


def auto_transition(action, root, sha, profile, fingerprint, source_run_id,
                    project_ref, database_host, database_url):
    states = scan_states(root)
    active = [(run_id, state) for run_id, state in states.items() if state["status"] != "cleaned"]
    db_fingerprint = hashlib.sha256(database_url.encode()).hexdigest()
    if action == "claim-smoke-auto":
        if active:
            raise ValueError("Another load-test fixture is active or cleanup-uncertain")
        if not SOURCE_RUN_ID.fullmatch(source_run_id or ""):
            raise ValueError("Trusted source Smoke run ID is invalid")
        if any(state.get("sourceRunId") == source_run_id for state in states.values()):
            raise ValueError("Smoke source workflow run was already consumed")
        run_id = f"load-{datetime.datetime.now(datetime.timezone.utc):%Y%m%d}-gh{source_run_id}"
        if not RUN_ID.fullmatch(run_id) or run_id in states:
            raise ValueError("Smoke source run identity was already consumed")
        state = {"runId": run_id, "deployedSha": sha, "profile": profile,
                 "profileFingerprint": fingerprint, "projectRef": project_ref,
                 "databaseHost": database_host, "dbFingerprint": db_fingerprint,
                 "sourceRunId": source_run_id, "sourceRunUrl": source_url(source_run_id),
                 "status": "smoke-claimed", "claimedAt": int(time.time())}
        persist(root / f"{run_id}.state.json", state, new=True)
        return state
    if len(active) != 1:
        raise ValueError("Ramp requires exactly one active verified Smoke fixture")
    run_id, state = active[0]
    age = int(time.time()) - state.get("verifiedAt", 0)
    if (state["status"] != "smoke-verified" or not 0 <= age <= MAX_SMOKE_AGE_SECONDS
            or state.get("deployedSha") != sha or state.get("profileFingerprint") != fingerprint
            or state.get("profile") != profile or state.get("projectRef") != project_ref
            or state.get("databaseHost") != database_host or state.get("dbFingerprint") != db_fingerprint
            or not SOURCE_RUN_ID.fullmatch(state.get("sourceRunId", ""))
            or state.get("sourceRunUrl") != source_url(state.get("sourceRunId"))):
        raise ValueError("Recent verified Smoke identity is unavailable or mismatched")
    manifest_bytes = private_bytes(root / f"{run_id}.json", 65536)
    manifest = json.loads(manifest_bytes)
    if (not re.fullmatch(r"[0-9a-f]{64}", state.get("verifiedManifestSha256", ""))
            or hashlib.sha256(manifest_bytes).hexdigest() != state["verifiedManifestSha256"]
            or not manifest_matches(manifest, run_id, sha, project_ref, database_host)
            or private_bytes(root / f"{run_id}.db-url", 4096).decode() != database_url):
        raise ValueError("Smoke fixture manifest or target identity mismatch")
    state["status"] = "ramp-claimed"
    state["rampClaimedAt"] = int(time.time())
    persist(root / f"{run_id}.state.json", state)
    return state


def transition(action, root, run_id, sha, profile_file, source_run_id=None,
               project_ref=None, database_host=None, env_file=None,
               deployed_sha_file=None, nonce=None, mac=None):
    if not SHA.fullmatch(sha) or (action not in {"claim-smoke-auto", "claim-ramp-auto"} and not RUN_ID.fullmatch(run_id or "")):
        raise ValueError("Invalid run or deployed SHA")
    private_directory(root)
    profile, fingerprint = read_profile(profile_file)
    if action in {"claim-smoke-auto", "claim-ramp-auto"}:
        if not (PROJECT_REF.fullmatch(project_ref or "") and DATABASE_HOST.fullmatch(database_host or "")
                and env_file and deployed_sha_file and nonce and mac):
            raise ValueError("Auto-claim target identity is incomplete")
    lock_path = root / ".claims.lock"
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(lock_fd)
        if lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
            raise ValueError("Attempt lock must be owner-only")
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        if action in {"claim-smoke-auto", "claim-ramp-auto"}:
            database_url = checked_database_url(env_file, deployed_sha_file, sha, project_ref,
                                                database_host, nonce, mac)
            return auto_transition(action, root, sha, profile, fingerprint, source_run_id,
                                   project_ref, database_host, database_url)
        path = root / f"{run_id}.state.json"
        state = read_state(path)
        if action == "claim-smoke":
            if any(item["status"] != "cleaned" for item in scan_states(root).values()):
                raise ValueError("Another load-test fixture is active or cleanup-uncertain")
            if state is not None:
                raise ValueError("Smoke attempt already exists")
            state = {"runId": run_id, "deployedSha": sha, "profile": profile,
                     "profileFingerprint": fingerprint, "status": "smoke-claimed", "claimedAt": int(time.time())}
            persist(path, state, new=True)
        else:
            if state is None or state.get("runId") != run_id or state.get("deployedSha") != sha or state.get("profileFingerprint") != fingerprint or state.get("profile") != profile:
                raise ValueError("Attempt identity or profile mismatch")
            if action == "verify-smoke":
                if state["status"] != "smoke-claimed":
                    raise ValueError("Smoke is not claimable for verification")
                if "sourceRunId" in state:
                    state["verifiedManifestSha256"] = hashlib.sha256(
                        private_bytes(root / f"{run_id}.json", 65536)).hexdigest()
                state["status"] = "smoke-verified"
                state["verifiedAt"] = int(time.time())
            elif action == "claim-ramp":
                age = int(time.time()) - state.get("verifiedAt", 0)
                if state["status"] != "smoke-verified" or not 0 <= age <= MAX_SMOKE_AGE_SECONDS:
                    raise ValueError("Recent verified smoke is unavailable")
                state["status"] = "ramp-claimed"
                state["rampClaimedAt"] = int(time.time())
            elif action == "mark-cleaned":
                if state["status"] == "cleaned":
                    raise ValueError("Attempt was already cleaned")
                if present(root / f"{run_id}.json") or present(root / f"{run_id}.db-url"):
                    raise ValueError("Fixture files must be removed before marking cleaned")
                state["status"] = "cleaned"
                state["cleanedAt"] = int(time.time())
            elif action != "inspect":
                raise ValueError("Unknown state action")
            if action != "inspect":
                persist(path, state)
        return state
    finally:
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["claim-smoke", "verify-smoke", "claim-ramp", "claim-smoke-auto", "claim-ramp-auto", "mark-cleaned", "inspect"])
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/load-test"))
    parser.add_argument("--run-id")
    parser.add_argument("--source-run-id")
    parser.add_argument("--project-ref")
    parser.add_argument("--database-host")
    parser.add_argument("--env-file", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/production.env"))
    parser.add_argument("--deployed-sha-file", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/deployed.sha"))
    parser.add_argument("--nonce")
    parser.add_argument("--mac")
    parser.add_argument("--deployed-sha", required=True)
    parser.add_argument("--profile-file", type=pathlib.Path, required=True)
    args = parser.parse_args()
    state = transition(args.action, args.root, args.run_id, args.deployed_sha, args.profile_file,
                       args.source_run_id, args.project_ref, args.database_host, args.env_file,
                       args.deployed_sha_file, args.nonce, args.mac)
    print(json.dumps({key: state[key] for key in ("runId", "deployedSha", "profileFingerprint", "status")}
                     | ({"sourceRunUrl": state["sourceRunUrl"]} if "sourceRunUrl" in state else {}),
                     separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"Attempt refused: {error}", file=sys.stderr)
        sys.exit(1)
