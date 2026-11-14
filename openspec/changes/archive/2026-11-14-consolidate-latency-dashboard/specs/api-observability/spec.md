## MODIFIED Requirements

### Requirement: Default local monitoring page

The default local Compose stack SHALL run Prometheus, Grafana, Alloy, and Loki. Prometheus SHALL scrape the API and worker every 60 seconds. Only credential-protected Grafana SHALL publish a localhost-bound host port. Provisioned Grafana data sources and dashboards SHALL show traffic, errors, p50/p90/p95/p99 latency, worker outcomes and duration, scrape health, confirmed spool drops, capacity-evicted events with unknown delivery status, and searchable logs. Every visible metric series SHALL have a concise plain-English legend rather than a raw formula or generic series name; variable process, kind, outcome, and reason labels MAY be included. The four overview latency panels SHALL each overlay completed API request, database query, and database pool-acquisition duration in seconds, with legends distinguishing these measurements and process labels for database series. Their titles SHALL be `P50 latency`, `P90 latency`, `P95 latency`, and `P99 latency`. The overview SHALL not show a `Within 200 ms` panel, and the single-series `5xx error fraction` panel SHALL not show a legend. No application monitoring page or alert delivery is included.

#### Scenario: Operator dashboard

- **WHEN** the default local stack is started with required credentials
- **THEN** an operator can open localhost Grafana and inspect the four consistently named overview latency overlays and an uncluttered error fraction panel

### Requirement: Database latency dashboard

Grafana SHALL show p50/p90/p95/p99 client-observed query and acquisition duration by process, plus database attempt rate and failure fraction. Attempts SHALL count executed queries and failed pool acquisitions, without double-counting successful acquisitions. Each of the four overview latency panels SHALL overlay completed HTTP request latency, database query duration, and database pool acquisition duration on a shared seconds scale, with distinct legends identifying the measurement and database process. The dashboard and operator documentation SHALL distinguish client-observed query duration from PostgreSQL server execution and geographic network latency.

#### Scenario: Operator diagnoses latency

- **WHEN** an operator opens the provisioned dashboard after database activity
- **THEN** P50, P90, P95, and P99 each display HTTP latency alongside database query duration and pool wait by process without exposing query contents
