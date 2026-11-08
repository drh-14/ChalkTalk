"""Validate runner configuration before any VM connection or host mutation."""

import os
import re
import sys


def validate(env: dict[str, str]) -> None:
    required = (
        "SSH_PRIVATE_KEY", "VM_HOST", "VM_SSH_PORT", "VM_KNOWN_HOSTS",
        "DOMAIN", "S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "DATABASE_URL",
        "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AUTH_TOKEN_SECRET",
        "RESEND_API_KEY",
    )
    if any(not env.get(name) for name in required):
        raise ValueError("VM bootstrap configuration is incomplete")
    host = env["VM_HOST"]
    port = env["VM_SSH_PORT"]
    if (not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host)
            or ".." in host or not port.isdecimal() or not 1 <= int(port) <= 65535
            or port != str(int(port))):
        raise ValueError("VM host or SSH port is invalid")
    expected_host = host if port == "22" else f"[{host}]:{port}"
    key_line = env["VM_KNOWN_HOSTS"]
    if "\n" in key_line or not key_line.startswith(expected_host + " "):
        raise ValueError("Pinned VM host key does not match VM host and port")
    if not re.fullmatch(r"(?:ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+(?: .*)?", key_line.split(" ", 1)[1]):
        raise ValueError("Pinned VM host key is malformed")
    if len(env["AUTH_TOKEN_SECRET"]) < 32:
        raise ValueError("Session secret is too short")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", env["DOMAIN"]):
        raise ValueError("Public domain is invalid")
    if any(("\n" in env[name] or "\r" in env[name] or "\\" in env[name]
            or "${" in env[name] or "replace-with-" in env[name])
           for name in required if name not in ("SSH_PRIVATE_KEY", "VM_KNOWN_HOSTS")):
        raise ValueError("Bootstrap value is invalid")


if __name__ == "__main__":
    try:
        validate(dict(os.environ))
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
