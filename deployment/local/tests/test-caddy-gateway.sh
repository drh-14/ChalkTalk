#!/bin/sh
set -eu

compose() {
  docker compose -f deployment/local/compose.yml --env-file .env "$@"
}

root=$(mktemp)
api_stopped=false
cleanup() {
  if [ "$api_stopped" = true ]; then
    compose up --no-deps -d api >/dev/null
  fi
  rm -f "$root"
}
trap cleanup EXIT
compose cp gateway:/data/caddy/pki/authorities/local/root.crt "$root"
origin="https://${DOMAIN:-localhost}:${WEB_PORT:-5173}"
test "$(curl --silent --show-error --fail --cacert "$root" "$origin/api/health")" = '{"status":"ok"}'
test "$(curl --silent --show-error --cacert "$root" --output /dev/null --write-out '%{http_code}' "$origin/api/v1/never-a-real-route")" = 404
test "$(curl --silent --show-error --cacert "$root" --output /dev/null --write-out '%{http_code}' "$origin/")" = 200
compose exec -T web node deployment/local/tests/gateway-websockets.mjs
compose exec -T web node -e 'require("node:http").get({ hostname: "127.0.0.1", port: 5173, path: "/", headers: { Host: "unapproved.example" } }, (response) => { response.resume(); process.exit(response.statusCode === 403 ? 0 : 1); }).on("error", () => process.exit(1))'

before=$(openssl x509 -in "$root" -noout -fingerprint -sha256)
compose restart gateway
compose cp gateway:/data/caddy/pki/authorities/local/root.crt "$root"
after=$(openssl x509 -in "$root" -noout -fingerprint -sha256)
test "$before" = "$after"
curl --silent --show-error --fail --cacert "$root" "$origin/api/health" >/dev/null

compose stop api >/dev/null
api_stopped=true
test "$(curl --silent --show-error --cacert "$root" --output /dev/null --write-out '%{http_code}' "$origin/api/health")" = 502
test "$(curl --silent --show-error --cacert "$root" --output /dev/null --write-out '%{http_code}' "$origin/")" = 200
compose up --no-deps -d api >/dev/null
api_stopped=false
ready=false
for _attempt in $(seq 1 30); do
  if curl --silent --fail --cacert "$root" "$origin/api/health" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
