#!/bin/sh
set -eu

# Run after `docker compose -f deployment/local/compose.yml --env-file .env up --build --wait` with a fresh local stack.
node --test docker/observability/grafana/dashboards/api.test.mjs docker/observability/compose-logging.test.mjs
compose() { docker compose -f deployment/local/compose.yml --env-file .env "$@"; }
api_request() {
  compose exec -T api node -e '
    fetch("http://localhost:3000/api/v1/never-a-real-route?private=do-not-log-this", {
      method: "POST", headers: { Origin: "https://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "private@example.edu", password: "do-not-log-this" })
    }).then((response) => {
      const id = response.headers.get("x-request-id");
      if (!id) process.exitCode = 1;
      else process.stdout.write(id + "\n");
    }).catch(() => { process.exitCode = 1; });'
}
metrics_check() {
  for service in api worker; do
    compose exec -T "$service" node -e '
      (async () => {
        const url = "http://localhost:3000/metrics";
        const denied = await fetch(url);
        const allowed = await fetch(url, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
        const body = await allowed.text();
        if (denied.status !== 401 || allowed.status !== 200 || !body.includes("chalktalk_jobs_total")) process.exitCode = 1;
      })().catch(() => { process.exitCode = 1; });'
  done
  compose exec -T collaboration node -e '
    (async () => {
      const url = "http://localhost:3100/metrics";
      const denied = await fetch(url);
      const allowed = await fetch(url, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
      const body = await allowed.text();
      if (denied.status !== 401 || allowed.status !== 200 || !body.includes("chalktalk_collaboration_connections")) process.exitCode = 1;
    })().catch(() => { process.exitCode = 1; });'
}
log_count() {
  compose exec -T api node -e '
    (async () => {
      const [service, needle] = process.argv.slice(1);
      const params = new URLSearchParams({ query: `{service="${service}"} |= "${needle}"`, limit: "100" });
      const response = await fetch(`http://loki:3100/loki/api/v1/query_range?${params}`);
      if (!response.ok) throw new Error(`Loki: ${response.status}`);
      const json = await response.json();
      console.log(json.data.result.flatMap((stream) => stream.values).length);
    })().catch(() => { process.exitCode = 1; });' "$1" "$2" 2>/dev/null
}
wait_log_count() {
  expected=$3
  count=0
  until actual=$(log_count "$1" "$2") && [ "$actual" -ge "$expected" ]; do
    count=$((count + 1))
    if [ "$count" -ge 90 ]; then echo "Loki did not ingest $1 event within 90 seconds" >&2; exit 1; fi
    sleep 1
  done
}
spool_count() {
  compose exec -T "$1" sh -c 'grep -R -F -h "$1" /var/log/chalktalk 2>/dev/null | wc -l' sh "$2"
}
wait_spool_count() {
  expected=$3
  count=0
  until actual=$(spool_count "$1" "$2") && [ "$actual" -ge "$expected" ]; do
    count=$((count + 1))
    if [ "$count" -ge 90 ]; then echo "$1 event was not persisted within 90 seconds" >&2; exit 1; fi
    sleep 1
  done
}

count=0
until metrics_check; do
  count=$((count + 1))
  if [ "$count" -ge 90 ]; then echo "Protected metrics unavailable after 90 seconds" >&2; exit 1; fi
  sleep 1
done
count=0
until compose exec -T api node -e '
  fetch("http://prometheus:9090/api/v1/query?query=up%7Bjob%3D~%22chalktalk-%28api%7Cworker%7Ccollaboration%29%22%7D")
  .then((response) => response.json()).then((data) => {
    if (data.data.result.length !== 3 || data.data.result.some((item) => item.value[1] !== "1")) process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });' >/dev/null 2>&1; do
  count=$((count + 1))
  if [ "$count" -ge 90 ]; then echo "Prometheus scrape unavailable" >&2; exit 1; fi
  sleep 1
done
compose exec -T api node -e '
  fetch("http://loki:3100/config")
    .then((response) => response.text())
    .then((config) => {
      if (!config.includes("retention_period: 1w") ||
          !config.includes("retention_enabled: true")) process.exitCode = 1;
    }).catch(() => { process.exitCode = 1; });'
before=$(api_request)
wait_log_count api "$before" 1
wait_log_count worker worker_started 1

# An unavailable collector must not block requests; persisted spool events catch up later.
compose stop alloy
queued=$(api_request)
worker_events_before=$(spool_count worker '"event":"worker_started"')
compose restart worker
wait_spool_count api "$queued" 1
wait_spool_count worker '"event":"worker_started"' "$((worker_events_before + 1))"
if [ "$(log_count api "$queued")" -ne 0 ]; then echo "Log arrived while Alloy was stopped" >&2; exit 1; fi
compose start alloy
wait_log_count api "$queued" 1
compose restart alloy
sleep 12
if [ "$(log_count api "$queued")" -ne 1 ]; then echo "Alloy replayed an already ingested event" >&2; exit 1; fi
compose restart api
count=0
until after=$(api_request); do
  count=$((count + 1))
  if [ "$count" -ge 30 ]; then echo "API did not recover after restart" >&2; exit 1; fi
  sleep 1
done
wait_log_count api "$after" 1
if compose logs api | grep -Eq 'do-not-log-this|private@example.edu' ||
   compose exec -T api grep -R -E -q 'do-not-log-this|private@example.edu' /var/log/chalktalk ||
   compose exec -T worker grep -R -E -q 'do-not-log-this|private@example.edu' /var/log/chalktalk ||
   [ "$(log_count api 'do-not-log-this')" -ne 0 ] ||
   [ "$(log_count api 'private@example.edu')" -ne 0 ]; then
  echo "Private request data appeared in local logs" >&2; exit 1
fi
password=$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' .env | tail -1)
count=0
until curl --fail --silent --show-error --user "admin:$password" "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/dashboards/uid/chalktalk-api" | grep -q 'ChalkTalk API observability'; do
  count=$((count + 1))
  if [ "$count" -ge 60 ]; then echo "Grafana dashboard unavailable" >&2; exit 1; fi
  sleep 1
done
curl --fail --silent --show-error --user "admin:$password" -H 'Content-Type: application/json' \
  -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"loki\",\"uid\":\"chalktalk-logs\"},\"expr\":\"{service=\\\"api\\\"} |= \\\"$before\\\"\",\"queryType\":\"range\",\"intervalMs\":60000,\"maxDataPoints\":100}],\"from\":\"now-6h\",\"to\":\"now\"}" \
  "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/ds/query" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const result = JSON.parse(input).results.A;
    if (!result?.frames?.some((frame) => frame.data.values.some((values) => values.some((value) => typeof value === "string" && value.includes(process.argv[1]))))) process.exitCode = 1;
  });' "$before"
echo "Observability smoke passed: metrics, Loki ingestion, outage/restart catch-up, no duplicate replay, privacy, Grafana"
