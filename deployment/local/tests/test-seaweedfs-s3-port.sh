#!/bin/sh
set -eu

directory=$(mktemp -d "$PWD/.seaweedfs-port-test-XXXXXX")
trap 'rm -rf "$directory"' EXIT
mkdir -p "$directory/deployment/local/tests" "$directory/bin"
cp deployment/local/tests/test-seaweedfs-s3.sh "$directory/deployment/local/tests/"
touch "$directory/deployment/local/compose.yml"

cat > "$directory/bin/docker" <<'EOF'
#!/bin/sh
set -eu
env_file=
for argument do
  if [ "${previous:-}" = --env-file ]; then env_file=$argument; fi
  previous=$argument
done
case "$*" in
  *' port seaweedfs 8333')
    port=$(sed -n 's/^SEAWEEDFS_HOST_PORT=//p' "$env_file")
    printf '127.0.0.1:%s\n' "${port:-8333}"
    ;;
  *' restart seaweedfs') ;;
  *) exit 1 ;;
esac
EOF

cat > "$directory/bin/curl" <<'EOF'
#!/bin/sh
set -eu
for argument do url=$argument; done
printf '%s\n' "$url" >> "$CURL_URL_LOG"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output=$2
      shift 2
      ;;
    --write-out)
      status=1
      shift 2
      ;;
    *) shift ;;
  esac
done
if [ "${status:-}" = 1 ]; then
  printf 404
elif [ -n "${output:-}" ] && [ "$output" != /dev/null ]; then
  printf 'ChalkTalk SeaweedFS S3 smoke payload\n' > "$output"
fi
EOF
chmod +x "$directory/bin/docker" "$directory/bin/curl"

for port in 8333 28333; do
  if [ "$port" = 8333 ]; then
    : > "$directory/.env"
  else
    printf 'SEAWEEDFS_HOST_PORT=%s\n' "$port" > "$directory/.env"
  fi
  log="$directory/curl-$port.log"
  : > "$log"
  (cd "$directory" && CURL_URL_LOG="$log" PATH="$directory/bin:$PATH" \
    sh deployment/local/tests/test-seaweedfs-s3.sh)
  if [ "$(wc -l < "$log" | tr -d ' ')" -ne 8 ]; then
    printf 'Unexpected S3 request count for port %s\n' "$port" >&2
    exit 1
  fi
  if grep -v "^http://127\.0\.0\.1:$port/" "$log"; then
    printf 'S3 request used wrong host port for port %s\n' "$port" >&2
    exit 1
  fi
done
