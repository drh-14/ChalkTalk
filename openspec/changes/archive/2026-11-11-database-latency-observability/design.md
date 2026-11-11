## Design

Instrument the shared `createPool` boundary rather than individual service call sites. Observe both `pool.query` and checked-out `client.query`, including transactions, without double counting. Preserve node-postgres promise/callback/config overloads and release semantics. Use a monotonic clock. The observer is optional; failures to record a sample are swallowed, never changing database behavior.

Register `chalktalk_db_pool_acquire_duration_seconds` and `chalktalk_db_query_duration_seconds` in each existing private process registry. The only explicit label is fixed `outcome=succeeded|failed`; Prometheus's target `job` distinguishes processes. Bucket boundaries span milliseconds to multi-second operations. The collaboration process uses its existing protected metrics registry; no new endpoint or provider is introduced. The separate PostgreSQL LISTEN connection is outside pooled-query metrics.

Client-observed query duration includes client queueing, network transport, PostgreSQL execution/locks, and response transfer; acquisition includes pool wait and new connection setup. Neither alone proves the source of geographic latency. Grafana panels aggregate by target job and show p50/p95, database attempt rate, and failure fraction. The attempt panels count executed queries plus failed pool acquisitions, but not successful acquisitions again. Metrics never include SQL, values, identities, or raw errors.

## Alternatives

Per-call-site timers leave coverage gaps; `pool.query`-only timers miss transactions; SQL logging leaks content; an OTel backend is disproportionate; Supabase-only statistics omit client network and pool wait.
