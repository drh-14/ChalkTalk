# Real-browser observability verification

Captured in Chromium against the real opt-in Compose stack on 2026-10-16. The API, PostgreSQL, Prometheus, Grafana, Logstash, and Elasticsearch were running; no application API responses were mocked.

1. Opened the provisioned Grafana dashboard and checked the request-rate, 5xx fraction, p50/p95/p99 latency, and 200 ms panels. [Dashboard overview](dashboard-overview.png)
2. Scrolled to the indexed, sanitized request-log panel and confirmed recent API requests appeared. [Unfiltered logs](logs-unfiltered.png)
3. Selected the `requestId` ad hoc filter with an exact known request ID. The panel displayed one matching log entry. [Filtered logs](logs-filtered.png)

The companion `docker/test-observability.sh` exercises the real protected scrape, Logstash outage/backlog replay, API restart, privacy boundary, seven-day Elasticsearch lifecycle policy, and Grafana datasource query.

After rebasing on the dedicated-worker, course-files, and digest commits, a fresh Chromium run on 2026-10-18 verified the provisioned **API and worker scrape health** panel showed both `api:3000` and `worker:3000` at `up = 1`: [Worker scrape health](worker-scrape-health.png). The updated smoke test checks bearer protection on both processes, both Prometheus targets, worker log indexing, and worker spool persistence across a Logstash outage.
