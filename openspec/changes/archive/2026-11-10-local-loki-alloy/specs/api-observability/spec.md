## MODIFIED Requirements

### Requirement: Bounded durable local log transport
When enabled, the API and dedicated worker SHALL each append sanitized NDJSON to separate local spools, rotate files at approximately 16 MiB, cap storage at 256 MiB, evict oldest segments and count capacity-evicted events separately from confirmed pre-persistence drops, and continue serving if the collector or disk fails. The delivery status of an evicted event SHALL be reported as unknown rather than definite loss. Alloy SHALL tail both spools from read-only mounts with persistent positions and send to Loki without Docker socket access. Loki-indexed logs and both spools SHALL have seven-day age retention; metric samples SHALL be retained for fifteen days. API and worker Docker stdout SHALL use size/count-bounded local logging with no seven-day age guarantee, so it may contain older events. Spooling SHALL not await the collector in a request.

#### Scenario: Collector outage and recovery
- **WHEN** Alloy or Loki is temporarily unavailable
- **THEN** API requests continue and surviving spooled events are available for replay on recovery

#### Scenario: Capacity or disk failure
- **WHEN** the spool reaches its cap or cannot be written
- **THEN** API requests still succeed and stdout continues; capacity eviction increments an at-risk event counter, while a rejected or failed spool write increments a definite-drop or error counter

#### Scenario: Docker stdout rotation
- **WHEN** local Compose runs the API and worker
- **THEN** each container's stdout log uses bounded local file rotation independent of the seven-day Loki and spool age limits

### Requirement: Default local monitoring page
The default local Compose stack SHALL run Prometheus, Grafana, Alloy, and Loki. Prometheus SHALL scrape the API and worker every 60 seconds. Only credential-protected Grafana SHALL publish a localhost-bound host port. Provisioned Grafana data sources and dashboards SHALL show traffic, errors, p50/p95/p99 latency, 200 ms compliance, worker outcomes and duration, scrape health, confirmed spool drops, capacity-evicted events with unknown delivery status, and searchable logs. No application monitoring page or alert delivery is included.

#### Scenario: Operator dashboard
- **WHEN** the default local stack is started with required credentials
- **THEN** an operator can open localhost Grafana and inspect provisioned metrics and logs
