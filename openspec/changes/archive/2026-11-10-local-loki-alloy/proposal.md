## Why

The default local stack's Elasticsearch and Logstash processes can exhaust a small Docker VM before the web app becomes ready. Replace that collector/store pair with a lighter local logging pipeline while preserving privacy-safe collection and the existing Grafana workflow.

## What Changes

- Replace local Elasticsearch/Logstash with Grafana Loki/Alloy, started by ordinary `docker compose up`.
- Tail the existing sanitized API/worker NDJSON spools with read-only mounts and persistent Alloy positions; do not grant Docker socket access.
- Store local logs in Loki with seven-day retention, and switch the provisioned Grafana log data source/panel and smoke checks to Loki.
- Keep Prometheus metrics and production logging behavior unchanged. Existing local Elasticsearch history remains in its old volume and is not migrated or automatically deleted.
- Simplify local setup to a single `DOMAIN` value, remove root Compose and environment templates and obsolete demo-seeding entry points, and keep explicit Piazza import as the course-population route.

## Capabilities

### Modified Capabilities

- `api-observability`: Replace the local collector and indexed store contract while retaining bounded, nonblocking sanitized logging and Grafana access.
- `local-compose-deployment`: Make Loki and Alloy part of the default single local stack instead of Elasticsearch and Logstash.

## Impact

Local Compose, Grafana provisioning/dashboard, observability smoke and configuration tests, local logging documentation, and OpenSpec references. Adds pinned Loki/Alloy container images; no production service or public API change.
