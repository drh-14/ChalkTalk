"""Validate runner configuration before any VM connection or host mutation."""

import os
import re
import sys


def validate(env: dict[str, str]) -> None:
    required = (
        "SSH_PRIVATE_KEY", "VM_HOST", "VM_KNOWN_HOSTS",
        "DOMAIN", "SUPABASE_STORAGE_ENDPOINT", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_REGION", "DATABASE_URL",
        "SUPABASE_STORAGE_ACCESS_KEY_ID", "SUPABASE_STORAGE_SECRET_ACCESS_KEY", "AUTH_TOKEN_SECRET",
        "RESEND_API_KEY", "METRICS_TOKEN", "GRAFANA_ADMIN_PASSWORD",
    )
    if any(not env.get(name) for name in required):
        raise ValueError("VM bootstrap configuration is incomplete")
    host = env["VM_HOST"]
    if (not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host)
            or ".." in host):
        raise ValueError("VM host is invalid")
    expected_host = host
    key_line = env["VM_KNOWN_HOSTS"]
    if "\n" in key_line or not key_line.startswith(expected_host + " "):
        raise ValueError("Pinned VM host key does not match VM host and port")
    if not re.fullmatch(r"(?:ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+(?: .*)?", key_line.split(" ", 1)[1]):
        raise ValueError("Pinned VM host key is malformed")
    if len(env["AUTH_TOKEN_SECRET"]) < 32:
        raise ValueError("Session secret is too short")
    if len(env["METRICS_TOKEN"]) < 32:
        raise ValueError("Metrics token is too short")
    if len(env["GRAFANA_ADMIN_PASSWORD"]) < 32:
        raise ValueError("Grafana admin password is too short")
    if (len(env["DOMAIN"]) > 253 or not re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+",
            env["DOMAIN"])):
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
