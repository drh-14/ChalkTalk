#!/bin/sh
# Operator host requirements: Docker/Compose and standard POSIX shell utilities.
set -eu
set +x
umask 077
local_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$local_dir/../.." && pwd)
env_file=$local_dir/.env
project=chalktalk
ack=false
seen_env=false
seen_project=false
usage_error() { printf '%s\n' "Local startup: $1" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) [ "$seen_env" = false ] || usage_error 'duplicate --env-file'; seen_env=true; [ "$#" -ge 2 ] || usage_error '--env-file requires a path'; env_file=$2; shift 2 ;;
    --project-name) [ "$seen_project" = false ] || usage_error 'duplicate --project-name'; seen_project=true; [ "$#" -ge 2 ] || usage_error '--project-name requires a name'; project=$2; shift 2 ;;
    --ack-external-migrations) [ "$ack" = false ] || usage_error 'duplicate --ack-external-migrations'; ack=true; shift ;;
    *) usage_error 'unknown option; supported: --env-file PATH --project-name NAME --ack-external-migrations' ;;
  esac
done
case "$project" in ''|[!a-z0-9]*|*[!a-z0-9_-]*) usage_error '--project-name must use lowercase letters, digits, underscore or hyphen' ;; esac
[ -f "$env_file" ] && [ -r "$env_file" ] || usage_error '--env-file must select a readable file (see deployment/local/.env.example)'
env_file=$(CDPATH= cd -- "$(dirname -- "$env_file")" && printf '%s/%s' "$(pwd)" "$(basename -- "$env_file")")
private=$(mktemp -d "${TMPDIR:-/tmp}/chalktalk-local.XXXXXXXX")
trap 'rm -rf -- "$private"' EXIT HUP INT TERM
: > "$private/resolved"
: > "$private/sources"
# Byte-level inspection is portable even where awk cannot represent a NUL string.
if ! LC_ALL=C od -An -tu1 "$env_file" | awk 'BEGIN {line=1} {for(i=1;i<=NF;i++){if(($i==0 || $i==13) && !bad){print "Local configuration: line " line " must not contain CR or NUL" > "/dev/stderr";bad=1}if($i==10)line++}} END {exit bad}'; then
  exit 1
fi
LC_ALL=C awk -v runtime="$private/resolved" -v topology="$private/topology" -v sources="$private/sources" -f "$local_dir/preflight.awk" "$env_file" || exit 1
db=$(sed -n '1p' "$private/topology")
store=$(sed -n '2p' "$private/topology")
# No original flags or local provisioning credentials reach application env_file.
awk -F= '$1 !~ /^(LOCAL_|DOMAIN$|WEB_PORT$|GRAFANA_)/ {print}' "$private/resolved" > "$private/application.env"
# Values already reject apostrophes, backslashes, dollars and controls. Quote the
# generated Compose interpolation file so literal spaces/# remain literal.
awk ' {p=index($0,"="); print substr($0,1,p) "\047" substr($0,p+1) "\047"}' "$private/resolved" > "$private/compose.env"
printf "LOCAL_APPLICATION_ENV_FILE='%s'\n" "$private/application.env" >> "$private/compose.env"
command -v docker >/dev/null 2>&1 || usage_error 'Docker with Compose is required'
# Empty environment neutralizes ALL inherited COMPOSE_* knobs and env discovery.
compose() {
  env -i PATH="$PATH" HOME="${HOME:-}" DOCKER_HOST="${DOCKER_HOST:-}" DOCKER_CONTEXT="${DOCKER_CONTEXT:-}" DOCKER_CONFIG="${DOCKER_CONFIG:-${HOME:-}/.docker}" \
    docker compose --project-directory "$local_dir" --project-name "$project" --env-file "$private/compose.env" "$@"
}
set -- -f "$local_dir/compose.yml"
[ "$db" = false ] || set -- "$@" -f "$local_dir/compose.database.yml"
[ "$store" = false ] || set -- "$@" -f "$local_dir/compose.store.yml"
if grep -q '^LOCAL_DATABASE_HOST_PORT=' "$private/resolved"; then set -- "$@" -f "$local_dir/compose.database-port.yml"; fi
if grep -q '^LOCAL_OBJECT_STORE_HOST_PORT=' "$private/resolved"; then set -- "$@" -f "$local_dir/compose.store-port.yml"; fi
# Narrow explicitly requested credential files only; never a home-directory mount.
if [ -s "$private/sources" ]; then
  {
    printf 'services:\n'
    for service in migrate api worker; do
      printf '  %s:\n    volumes:\n' "$service"
      while IFS='=' read -r key source; do
        printf '      - type: bind\n        source: %s\n        target: /run/chalktalk-aws/%s\n        read_only: true\n        bind:\n          create_host_path: false\n' "$source" "$key"
      done < "$private/sources"
    done
  } > "$private/compose.aws.yml"
  set -- "$@" -f "$private/compose.aws.yml"
fi
compose "$@" config --format json >/dev/null 2>&1 || usage_error 'Compose configuration is invalid; inspect the named settings without printing secrets'
printf '%s\n' 'Static configuration accepted. Preparing isolated runtime checks.'
compose "$@" stop gateway web api worker collaboration >/dev/null 2>&1 || usage_error 'could not gate existing application processes'
if [ "$db" = false ]; then compose -f "$local_dir/compose.yml" -f "$local_dir/compose.database.yml" stop postgres >/dev/null 2>&1 || usage_error 'could not stop deselected bundled database'; fi
if [ "$store" = false ]; then compose -f "$local_dir/compose.yml" -f "$local_dir/compose.store.yml" stop seaweedfs >/dev/null 2>&1 || usage_error 'could not stop deselected bundled object store'; fi
compose "$@" build >/dev/null 2>&1 || usage_error 'image build failed; application traffic/workers remain gated'
if [ "$db" = true ]; then compose "$@" up -d --wait postgres >/dev/null 2>&1 || usage_error 'bundled database is unavailable; data retained'; fi
if [ "$store" = true ]; then compose "$@" up -d --wait seaweedfs >/dev/null 2>&1 || usage_error 'bundled object store is unavailable; data retained'; fi
# All read-only checks finish before any ownership-authorized preparation.
if ! compose "$@" run --rm --no-deps migrate node --import tsx deployment/local/runtime.ts check "$db" "$store" "$ack" >"$private/runtime.log" 2>&1; then
  LC_ALL=C sed -n '/^External ordinary migrations pending: [A-Za-z0-9_., ;:-]*$/p' "$private/runtime.log" >&2
  usage_error 'runtime compatibility/credential check failed; traffic/workers remain gated; check external schema, bucket and SES source prerequisites'
fi
compose "$@" run --rm --no-deps migrate node --import tsx deployment/local/runtime.ts prepare "$db" "$store" "$ack" >/dev/null 2>&1 || usage_error 'authorized preparation failed; traffic/workers remain gated; existing data retained'
if ! compose "$@" up -d --wait --wait-timeout 240 api worker collaboration web gateway loki alloy node-exporter node-exporter-network prometheus grafana >/dev/null 2>&1; then
  compose "$@" stop gateway web api worker collaboration >/dev/null 2>&1 || usage_error 'application startup failed; could not gate application processes; data retained'
  usage_error 'application startup failed; data retained'
fi
printf '%s\n' 'Local services started. No seed, reset, or data deletion was performed.'
