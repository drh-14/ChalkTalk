"""VM-owned, fail-closed attempt ledger for manually dispatched k6 runs."""

import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import time

RUN_ID = re.compile(r"load-[0-9]{8}-[a-z0-9]{8,32}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
MAX_PROFILE_BYTES = 4096
MAX_SMOKE_AGE_SECONDS = 30 * 60


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


def transition(action, root, run_id, sha, profile_file):
    if not RUN_ID.fullmatch(run_id) or not SHA.fullmatch(sha):
        raise ValueError("Invalid run or deployed SHA")
    private_directory(root)
    profile, fingerprint = read_profile(profile_file)
    lock_path = root / ".claims.lock"
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(lock_fd)
        if lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
            raise ValueError("Attempt lock must be owner-only")
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        path = root / f"{run_id}.state.json"
        state = read_state(path)
        if action == "claim-smoke":
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
    parser.add_argument("action", choices=["claim-smoke", "verify-smoke", "claim-ramp", "mark-cleaned", "inspect"])
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/load-test"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--deployed-sha", required=True)
    parser.add_argument("--profile-file", type=pathlib.Path, required=True)
    args = parser.parse_args()
    state = transition(args.action, args.root, args.run_id, args.deployed_sha, args.profile_file)
    print(json.dumps({key: state[key] for key in ("runId", "deployedSha", "profileFingerprint", "status")}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f"Attempt refused: {error}", file=sys.stderr)
        sys.exit(1)
