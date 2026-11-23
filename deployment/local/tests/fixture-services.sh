#!/bin/sh
# Trusted test helper, never operator configuration. No default/operator project.
: "${TEST_PROJECT_NAME:?Set an explicitly owned disposable TEST_PROJECT_NAME}"
case "$TEST_PROJECT_NAME" in ct-modular-*) ;; *) echo 'Refusing a project outside the owned ct-modular-* fixture namespace' >&2; exit 1 ;; esac
fixture_container() {
  id=$(docker ps -aq --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME" --filter "label=com.docker.compose.service=$1")
  [ -n "$id" ] || { echo "Missing owned fixture service: $1" >&2; return 1; }
  printf '%s' "$id"
}
compose() {
  operation=$1; shift
  case "$operation" in
    exec) [ "${1:-}" != -T ] || shift; service=$1; shift; docker exec -i "$(fixture_container "$service")" "$@" ;;
    cp) source=$1; shift; service=${source%%:*}; path=${source#*:}; docker cp "$(fixture_container "$service"):$path" "$@" ;;
    logs)
      while [ "$#" -gt 0 ]; do case "$1" in --no-color) shift ;; --tail) shift 2 ;; *) break ;; esac; done
      if [ "$#" -gt 0 ]; then docker logs "$(fixture_container "$1")"; else
        for id in $(docker ps -aq --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME"); do docker logs "$id"; done
      fi ;;
    ps) docker ps --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME" --format '{{.Label "com.docker.compose.service"}}' ;;
    down)
      ids=$(docker ps -aq --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME")
      [ -z "$ids" ] || docker rm -f $ids
      volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME")
      [ -z "$volumes" ] || docker volume rm $volumes
      networks=$(docker network ls -q --filter "label=com.docker.compose.project=$TEST_PROJECT_NAME")
      [ -z "$networks" ] || docker network rm $networks ;;
    start|stop|restart) for service in "$@"; do docker "$operation" "$(fixture_container "$service")"; done ;;
    up)
      wait_ready=false
      while [ "${1#-}" != "$1" ]; do [ "$1" != --wait ] || wait_ready=true; shift; done
      for service in "$@"; do
        id=$(fixture_container "$service"); docker start "$id"
        if [ "$wait_ready" = true ]; then
          attempt=0
          while [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}' "$id")" != healthy ]; do
            attempt=$((attempt+1)); [ "$attempt" -lt 120 ] || { echo 'Fixture readiness timed out' >&2; return 1; }; sleep 1
          done
        fi
      done ;;
    *) echo 'Unsupported fixture operation' >&2; return 1 ;;
  esac
}
