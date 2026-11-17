"""VM-only Supabase identity check and owner-only fixture URL preparation."""

import argparse
import hashlib
import hmac
import os
import pathlib
import re
import shlex
import stat
import sys
from urllib.parse import parse_qs, urlsplit

RUN_ID = re.compile(r"load-[0-9]{8}-[a-z0-9]{8,32}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
REF = re.compile(r"[a-z0-9]{20}\Z")
HOST = re.compile(r"[a-z0-9.-]+\.supabase\.com\Z")


def deployed_database_url(path):
    values = []
    for line in path.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            parts = shlex.split(line.partition("=")[2])
            if len(parts) != 1:
                raise ValueError("Deployed database setting is malformed")
            values.append(parts[0])
    if len(values) != 1:
        raise ValueError("Expected one deployed database setting")
    return values[0]


def checked_database_url(env_file, sha_file, sha, project_ref, host, nonce, mac):
    if not (SHA.fullmatch(sha) and REF.fullmatch(project_ref)
            and HOST.fullmatch(host) and re.fullmatch(r"[0-9a-f]{32}", nonce)
            and re.fullmatch(r"[0-9a-f]{64}", mac)):
        raise ValueError("Invalid load-test identity")
    if sha_file.read_text().strip() != sha:
        raise ValueError("Deployed SHA mismatch")
    database_url = deployed_database_url(env_file)
    parsed = urlsplit(database_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    if (parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname != host
            or parsed.username != f"postgres.{project_ref}" or not parsed.password
            or parsed.path != "/postgres" or parsed.fragment
            or params.get("sslmode") != ["verify-full"]):
        raise ValueError("Deployed Supabase database target mismatch")
    expected = hmac.new(database_url.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, mac):
        raise ValueError("GitHub and deployed database URL mismatch")
    return database_url


def prepare(root, env_file, sha_file, run_id, sha, project_ref, host, nonce, mac):
    if not RUN_ID.fullmatch(run_id):
        raise ValueError("Invalid load-test identity")
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != os.getuid() or root_info.st_mode & 0o077:
        raise ValueError("Load-test directory must be owner-only")
    database_url = checked_database_url(env_file, sha_file, sha, project_ref, host, nonce, mac)
    path = root / f"{run_id}.db-url"
    try:
        info = path.lstat()
    except FileNotFoundError:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(descriptor, database_url.encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        directory_fd = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    else:
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or path.read_text() != database_url):
            raise ValueError("Existing fixture URL file does not match deployed target")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare"])
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/load-test"))
    parser.add_argument("--env-file", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/production.env"))
    parser.add_argument("--deployed-sha-file", type=pathlib.Path, default=pathlib.Path("/srv/chalktalk/shared/deployed.sha"))
    parser.add_argument("--run-id")
    parser.add_argument("--deployed-sha", required=True)
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--database-host", required=True)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--mac", required=True)
    args = parser.parse_args()
    prepare(args.root, args.env_file, args.deployed_sha_file, args.run_id or "", args.deployed_sha,
            args.project_ref, args.database_host, args.nonce, args.mac)
    print("Deployed database target and storage project match")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"Fixture target refused: {error}", file=sys.stderr)
        sys.exit(1)
