#!/usr/bin/env bash
# Run on the prepared VM from the exact CI checkout: bash -s -- stage|finish SHA.
set -euo pipefail

phase="${1:-}"
sha="${2:-}"
[[ "$phase" == stage || "$phase" == finish ]] || { echo 'Invalid phase' >&2; exit 2; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 2; }

root="${CHALKTALK_DEPLOY_ROOT:-/srv/chalktalk}"
shared="$root/shared"
releases="$root/releases"
env_file="$shared/production.env"
repository='https://github.com/drh-14/ChalkTalk.git'
[[ -f "$env_file" && -s "$env_file" ]] || { echo 'Missing shared production.env' >&2; exit 1; }
mkdir -p "$releases"
exec 9>"$shared/deploy.lock"
flock -x 9

assert_current_main() {
  local current
  current="$(git ls-remote "$repository" refs/heads/main | cut -f1)"
  [[ "$current" == "$sha" ]] || { echo 'Stale deployment SHA; main moved' >&2; exit 1; }
}

assert_current_main
release="$releases/$sha"
export COMPOSE_ENV_FILE="$env_file"
compose() { docker compose --env-file "$env_file" -f "$release/deployment/production/compose.yml" "$@"; }

if [[ "$phase" == finish ]]; then
  if [[ -f "$shared/deployed.sha" && "$(cat "$shared/deployed.sha")" == "$sha" ]]; then exit 0; fi
  [[ -f "$shared/pending.sha" && "$(cat "$shared/pending.sha")" == "$sha" ]] || {
    echo 'No successful pending release to mark' >&2; exit 1;
  }
  printf '%s\n' "$sha" > "$shared/deployed.sha.tmp"
  mv -f "$shared/deployed.sha.tmp" "$shared/deployed.sha"
  rm -f "$shared/pending.sha"
  exit 0
fi

if [[ -f "$shared/deployed.sha" && "$(cat "$shared/deployed.sha")" == "$sha" ]]; then
  echo 'Release already marked successful; provider smoke skipped'
  exit 0
fi
rm -f "$shared/pending.sha"
if [[ ! -d "$release" ]]; then
  incoming="$(mktemp -d "$releases/.incoming.XXXXXX")"
  trap 'rm -rf "$incoming"' EXIT
  git clone --no-checkout --depth=1 --branch main "$repository" "$incoming/checkout"
  git -C "$incoming/checkout" checkout --detach "$sha"
  [[ "$(git -C "$incoming/checkout" rev-parse HEAD)" == "$sha" ]] || {
    echo 'Checked-out commit does not match CI' >&2; exit 1;
  }
  mv "$incoming/checkout" "$release"
  rmdir "$incoming"
  trap - EXIT
fi
[[ "$(git -C "$release" rev-parse HEAD)" == "$sha" ]] || {
  echo 'Release checkout changed unexpectedly' >&2; exit 1;
}
[[ -z "$(git -C "$release" status --porcelain)" ]] || {
  echo 'Release checkout has local changes' >&2; exit 1;
}

# Recheck after checkout and while holding the VM lock, immediately before mutation.
assert_current_main
compose config --quiet
compose build web api collaboration worker
compose up -d --wait --wait-timeout 240

migrate_id="$(compose ps -aq migrate)"
[[ -n "$migrate_id" && "$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$migrate_id")" == 'exited 0' ]] || {
  echo 'Migration did not complete successfully' >&2; exit 1;
}
for service in worker collaboration; do
  container_id="$(compose ps -aq "$service")"
  [[ -n "$container_id" && "$(docker inspect --format '{{.State.Status}}' "$container_id")" == running ]] || {
    echo "$service is not running" >&2; exit 1;
  }
done
compose run --rm --no-deps api node apps/api/dist/deployment/smoke.js "$sha"
printf '%s\n' "$sha" > "$shared/pending.sha.tmp"
mv -f "$shared/pending.sha.tmp" "$shared/pending.sha"
echo 'Release started and provider smoke accepted; awaiting external HTTPS check'
