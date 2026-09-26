#!/bin/sh
set -eu

fingerprint_file="/app/node_modules/.chalktalk-dependency-fingerprint"
expected_fingerprint="node=$(node --version) lockfile=$(sha256sum /app/package-lock.json | awk '{print $1}')"

if [ ! -f "$fingerprint_file" ] || [ "$(cat "$fingerprint_file")" != "$expected_fingerprint" ]; then
  echo "Installing container dependencies for the current Node runtime and lockfile..."
  npm ci
  printf '%s\n' "$expected_fingerprint" > "$fingerprint_file"
fi

exec "$@"
