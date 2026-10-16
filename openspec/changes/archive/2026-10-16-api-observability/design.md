## Context

The approved design is recorded in `docs/design/2026-10-16-api-observability.md`. The current API uses Express 5, assigns `X-Request-Id`, and runs the deletion worker in process. Local Compose starts dependencies by default and app containers through `app` profile.

## Goals / Non-Goals

**Goals:** local API/job metrics, private structured events, bounded offline log transport, and a Grafana operator page.

**Non-Goals:** production AWS deployment, browser RUM, Hocuspocus, alerts, in-app monitoring UI, unrestricted content logging.

## Decisions

Use Prometheus Node client with a private registry and static labels. Register request instrumentation before parsing, resolve the matched Express route template after completion, and expose `/metrics` only when enabled with a constant-time bearer check. Use a single sanitation function for stdout and spool. Disk writes are asynchronous with bounded in-memory buffering; spool segments rotate at 16 MiB and evict oldest at 256 MiB. Logstash tails files with persisted offsets and queue, forwarding to Elasticsearch with seven-day lifecycle deletion. Grafana has provisioned Prometheus/Elasticsearch data sources and localhost binding. See the approved design for topology, rejected alternatives, and failure behavior.

## Risks / Trade-offs

A crash can lose an in-memory tail; queue/checkpoint replay can duplicate logs, and a long outage can exceed finite spool/queue capacity. The API stays available. Confirmed pre-persistence drops and capacity evictions with unknown delivery status have separate counters, so routine retention does not masquerade as confirmed log loss. Local plaintext collector links and retention are not the production deployment design.
