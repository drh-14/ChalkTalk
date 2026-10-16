#!/bin/sh
set -eu

# Run after `docker compose --profile app --profile observability up --build --wait`.
compose() { docker compose --profile app --profile observability "$@"; }
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
  compose exec -T api node -e '
    (async () => {
      const url = "http://localhost:3000/metrics";
      const denied = await fetch(url);
      const allowed = await fetch(url, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
      const text = await allowed.text();
      if (denied.status !== 401 || allowed.status !== 200 || !text.includes("chalktalk_http_requests_total") || text.includes("do-not-log-this")) process.exitCode = 1;
    })().catch(() => { process.exitCode = 1; });'
}
indexed() {
  compose exec -T api node -e '
    (async () => {
      const id = process.argv[1];
      const response = await fetch("http://elasticsearch:9200/chalktalk-logs-*/_search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: { term: { requestId: id } }, size: 1 })
      });
      if (!response.ok) process.exitCode = 1;
      else { const result = await response.json(); if (result.hits.total.value < 1) process.exitCode = 1; }
    })().catch(() => { process.exitCode = 1; });' "$1" >/dev/null 2>&1
}
wait_indexed() {
  count=0
  until indexed "$1"; do
    count=$((count + 1))
    if [ "$count" -ge 90 ]; then echo "Log event was not indexed within 90 seconds" >&2; exit 1; fi
    sleep 1
  done
}

metrics_check
count=0
until compose exec -T api node -e '
  fetch("http://prometheus:9090/api/v1/query?query=up%7Bjob%3D%22chalktalk-api%22%7D")
  .then((response) => response.json()).then((data) => {
    if (data.data.result.length !== 1 || data.data.result[0].value[1] !== "1") process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });' >/dev/null 2>&1; do
  count=$((count + 1))
  if [ "$count" -ge 90 ]; then echo "Prometheus did not scrape the API within 90 seconds" >&2; exit 1; fi
  sleep 1
done
before=$(api_request)
wait_indexed "$before"
compose stop logstash
queued=$(api_request)
count=0
until compose exec -T api grep -R -q "$queued" /var/log/chalktalk; do
  count=$((count + 1))
  if [ "$count" -ge 30 ]; then echo "Log event was not spooled within 30 seconds" >&2; exit 1; fi
  sleep 1
done
compose start logstash
wait_indexed "$queued"
compose restart api
count=0
until metrics_check; do
  count=$((count + 1))
  if [ "$count" -ge 30 ]; then echo "API did not recover within 30 seconds" >&2; exit 1; fi
  sleep 1
done
after=$(api_request)
wait_indexed "$after"
if compose logs api | grep -Eq 'do-not-log-this|private@example.edu'; then
  echo "Private request data appeared in API stdout" >&2; exit 1
fi
if compose exec -T api grep -R -E -q 'do-not-log-this|private@example.edu' /var/log/chalktalk; then
  echo "Private request data appeared in the spool" >&2; exit 1
fi
compose exec -T api node -e '
  fetch("http://elasticsearch:9200/chalktalk-logs-*/_search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { query_string: { query: "do-not-log-this OR private@example.edu" } } })
  }).then((response) => response.json()).then((result) => {
    if (result.hits.total.value !== 0) process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });'
compose exec -T api node -e '
  fetch("http://elasticsearch:9200/_ilm/policy/chalktalk-local-7d")
  .then((response) => response.json()).then((data) => {
    if (data["chalktalk-local-7d"].policy.phases.delete.min_age !== "7d") process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });'
password=$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' .env | tail -1)
count=0
until curl --fail --silent --show-error --user "admin:$password" "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/dashboards/uid/chalktalk-api" | grep -q 'ChalkTalk API observability'; do
  count=$((count + 1))
  if [ "$count" -ge 60 ]; then echo "Grafana dashboard unavailable" >&2; exit 1; fi
  sleep 1
done
curl --fail --silent --show-error --user "admin:$password" "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/dashboards/uid/chalktalk-api" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const dashboard = JSON.parse(input).dashboard;
    const logPanel = dashboard.panels.find((panel) => panel.type === "logs");
    if (logPanel?.targets[0]?.query !== "*" ||
      !dashboard.templating.list.some((variable) => variable.type === "adhoc" && variable.datasource.uid === "chalktalk-logs")) process.exitCode = 1;
  });'
curl --fail --silent --show-error --user "admin:$password" -H 'Content-Type: application/json' \
  -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"elasticsearch\",\"uid\":\"chalktalk-logs\"},\"query\":\"requestId:$before\",\"metrics\":[{\"id\":\"1\",\"type\":\"logs\"}],\"queryType\":\"logs\",\"intervalMs\":60000,\"maxDataPoints\":100}],\"from\":\"now-6h\",\"to\":\"now\"}" \
  "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/ds/query" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const frame = JSON.parse(input).results.A.frames[0];
    const index = frame.schema.fields.findIndex((field) => field.name === "requestId");
    if (index < 0 || frame.data.values[index].length !== 1) process.exitCode = 1;
  });'
echo "Observability smoke passed: protected metrics, indexed logs, outage/recovery, restart, privacy, retention, Grafana dashboard"
