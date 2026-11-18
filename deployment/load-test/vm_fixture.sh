#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 5 || $# -eq 6 ]] || { echo 'Usage: vm_fixture.sh provision|inventory|teardown RUN_ID SHA PROJECT_REF DB_HOST [mode|confirm-delete]' >&2; exit 2; }
action=$1 run_id=$2 sha=$3 project_ref=$4 db_host=$5
[[ $action == provision || $action == inventory || $action == teardown ]] || exit 2
[[ $run_id =~ ^load-[0-9]{8}-[a-z0-9]{8,32}$ && $sha =~ ^[0-9a-f]{40}$ && $project_ref =~ ^[a-z0-9]{20}$ && $db_host =~ ^[a-z0-9.-]+\.supabase\.com$ ]] || exit 2
if [[ $action == provision ]]; then
  [[ $# -eq 6 && ( $6 == smoke || $6 == ramp ) ]] || { echo 'Explicit fixture mode required' >&2; exit 2; }
elif [[ $action == teardown ]]; then
  [[ $# -eq 6 && $6 == "$run_id" ]] || { echo 'Explicit matching cleanup confirmation required' >&2; exit 2; }
else
  [[ $# -eq 5 ]] || exit 2
fi
root=/srv/chalktalk/shared/load-test
release=/srv/chalktalk/releases/$sha
[[ $(cat /srv/chalktalk/shared/deployed.sha) == "$sha" && -f "$root/$run_id.db-url" && -d "$release" ]] || { echo 'VM release or prepared target mismatch' >&2; exit 1; }
cd "$release"
export COMPOSE_ENV_FILE=/srv/chalktalk/shared/production.env
export GRAFANA_ENV_FILE=/srv/chalktalk/shared/grafana.env
args=("$action" --confirm-production joinchalktalk.com --expected-project-ref "$project_ref" --expected-host "$db_host" --run-id "$run_id" --deployed-sha "$sha" --deployed-sha-file /run/deployed.sha --db-url-file "/run/load-test/$run_id.db-url" --manifest "/run/load-test/$run_id.json")
[[ $action != teardown ]] || args+=(--confirm-delete "$run_id")
[[ $action != provision ]] || args+=(--mode "$6")
docker compose --env-file "$COMPOSE_ENV_FILE" -f deployment/production/compose.yml run --rm --no-deps --user "$(id -u):$(id -g)" \
  -v "$root:/run/load-test" -v /srv/chalktalk/shared/deployed.sha:/run/deployed.sha:ro \
  --entrypoint node api apps/api/dist/database/load-test-fixture-cli.js "${args[@]}"
if [[ $action == teardown ]]; then
  rm -- "$root/$run_id.db-url"
fi
