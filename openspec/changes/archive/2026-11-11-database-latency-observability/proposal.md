## Why

Operators can see HTTP latency but cannot distinguish PostgreSQL pool wait from client-observed query time. That prevents evidence-based diagnosis of the reported API delay between the OVHcloud VM and Supabase.

## What Changes

- Observe pooled-client acquisition and query duration separately in API, worker, and collaboration processes.
- Expose bounded, privacy-safe histograms through their existing protected metrics endpoints.
- Add Grafana panels for latency distributions, database attempt rate, and failure fraction, with clear interpretation guidance.

No database schema, public application API, SQL logging, or new service changes.

## Capabilities

### Modified Capabilities

- `api-observability`: Database timing in all three process metrics registries and Grafana.
