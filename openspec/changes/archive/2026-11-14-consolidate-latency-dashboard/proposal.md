## Why

The overview dashboard uses inconsistent latency titles, omits p90 and database/pool overlays at p99, and spends space on a redundant 200 ms panel and a single-series legend.

## What Changes

- Show p50, p90, p95, and p99 overview latency panels with API, database query, and pool-acquisition series on each.
- Title them `P50 latency`, `P90 latency`, `P95 latency`, and `P99 latency`; keep the measurement names in each legend.
- Remove the `Within 200 ms` panel and hide the legend on `5xx error fraction`.
- Give every visible metric series a concise plain-English legend instead of a raw formula or generic series name.

## Capabilities

### Modified Capabilities

- `api-observability`: Consolidate provisioned overview latency and error presentation without changing telemetry collection.
