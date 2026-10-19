## Context

The approved design is recorded in `docs/design/2026-10-16-api-observability.md`. The API uses Express 5 and assigns `X-Request-Id`; queued jobs and daily digests now run in the separate worker process. Local Compose starts dependencies by default and app containers through `app` profile.

## Goals / Non-Goals

**Goals:** local API/job metrics, private structured events, bounded offline log transport, and a Grafana operator page.

**Non-Goals:** production AWS deployment, browser RUM, Hocuspocus, alerts, in-app monitoring UI, unrestricted content logging.

## Decisions

Use Prometheus Node client with separate API and worker registries and static labels. Register request instrumentation before parsing, resolve the matched Express route template after completion, and expose a private `/metrics` route in each process only when enabled with a constant-time bearer check. Use the same sanitized event schema for stdout and each process's own spool. API and worker Docker stdout uses size/count-bounded local logging and may contain events older than seven days. Disk writes are asynchronous with bounded in-memory buffering; each spool rotates at 16 MiB, evicts oldest at 256 MiB, and expires segments after seven days. Logstash tails both volumes with persisted offsets and queue, forwarding to daily Elasticsearch indices named from event dates. ILM parses the origination date from each index name so seven-day lifecycle deletion also applies to delayed replay. Grafana has provisioned Prometheus/Elasticsearch data sources and localhost binding. See the approved design for topology, rejected alternatives, and failure behavior.

## Risks / Trade-offs

A crash can lose an in-memory tail; queue/checkpoint replay can duplicate logs, and a long outage can exceed finite spool/queue capacity. The API stays available. Confirmed pre-persistence drops and capacity evictions with unknown delivery status have separate counters, so routine retention does not masquerade as confirmed log loss. Local plaintext collector links and retention are not the production deployment design.
