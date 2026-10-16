## Why

API latency and background-job failures are not observable in the local stack. Operators need safe metrics, searchable logs, and a monitoring page without exposing private course content or making API availability depend on telemetry.

## What Changes

- Instrument API requests and in-process jobs with low-cardinality Prometheus metrics and sanitized structured JSON logs.
- Add a bearer-protected `/metrics` route when observability is enabled.
- Spool sanitized logs to bounded, rotating disk files without blocking requests; forward them through Logstash to Elasticsearch.
- Add an opt-in local Compose profile for Prometheus, Grafana, Logstash, and Elasticsearch with provisioned dashboards, 7-day log and 15-day metric retention.
- Document and test privacy, outages, recovery, and capacity loss.

## Capabilities

### New Capabilities

- `api-observability`: Local API and job metrics, safe structured logs, durable bounded collection, and Grafana monitoring.

### Modified Capabilities

- None.

## Impact

API configuration, Express and job instrumentation, local Compose and monitoring configuration, dependencies, tests, and operations documentation. No production AWS deployment, browser RUM, Hocuspocus instrumentation, in-app monitoring page, or alerts.
