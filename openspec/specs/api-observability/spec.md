# api-observability Specification

## Purpose

Provides local operators with API and background-job latency, reliability, and privacy-safe logs without making application availability depend on collection.

## Requirements

### Requirement: Request metrics and protected scrape

The API SHALL expose Prometheus request counts and duration histograms using only bounded method, matched route template, status class, and outcome labels. Buckets SHALL include 0.2 seconds. The metrics endpoint SHALL exist only when a valid `METRICS_TOKEN` and spool directory are configured and SHALL require that bearer token; health and scrape traffic SHALL not distort application latency. Production SHALL require those settings before serving work.

#### Scenario: Authenticated scrape

- **WHEN** a caller presents the correct bearer token to an enabled `/metrics`
- **THEN** Prometheus-format request and process metrics are returned

#### Scenario: Unauthorized or disabled scrape

- **WHEN** the token is absent or invalid, or observability is disabled locally
- **THEN** no metrics are disclosed

#### Scenario: Sensitive or unmatched path

- **WHEN** a request URL contains an identifier or query, or no route matches
- **THEN** no raw path, identifier, or query is used in a metric label

#### Scenario: Token-driven enablement

- **WHEN** a valid metrics token and spool directory are configured locally without an observability flag
- **THEN** protected metrics and sanitized event spooling are enabled

#### Scenario: No token in production

- **WHEN** a production API, worker, or collaboration process starts without a valid metrics token or required spool directory
- **THEN** startup fails before serving work

#### Scenario: Production monitoring remains off

- **WHEN** a production process receives an invalid metrics token or lacks its required spool directory
- **THEN** startup fails rather than exposing partially configured monitoring

#### Scenario: Protected production monitoring

- **WHEN** production starts with valid monitoring configuration
- **THEN** metrics and sanitized event spooling are enabled without publishing the metrics endpoints publicly

### Requirement: Background-job metrics

The dedicated worker SHALL record attempted jobs and digest scheduling/delivery and duration by fixed job kind and success/failure outcome, without job payload or identifiers.

#### Scenario: Worker completes or fails

- **WHEN** a claimed job finishes or fails
- **THEN** its outcome and duration are reflected in bounded metrics

### Requirement: Sanitized structured logging

The API and dedicated worker SHALL emit JSON events for completed or aborted requests, job outcomes, and unexpected errors, as applicable to each process. Events SHALL contain only UTC time, level, event name, request ID, method, route template, status, duration, bounded error code, and explicitly allowlisted low-risk enums, booleans, or counts for selected routes. Auth, account, and resource endpoints SHALL log metadata only. It SHALL never log raw URL/query, headers, identities, free text, files, arbitrary request/response objects, raw errors, or stacks. Unknown routes SHALL be metadata only. The same sanitized event SHALL go to stdout and optional spool.

#### Scenario: Private payload and errors

- **WHEN** a request contains passwords, tokens, course text, identifiers, query parameters, or file bytes, or raises an exception
- **THEN** none of those sensitive values appears in stdout or spooled events

#### Scenario: Safe response metadata

- **WHEN** an allowlisted route returns a known safe enum, boolean, or count
- **THEN** only that bounded field may be included

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

### Requirement: Private production monitoring dashboard

The production Compose stack SHALL run Prometheus, Loki, Alloy, and Grafana. Prometheus SHALL collect protected application metrics. Alloy SHALL ingest only sanitized API and worker spools without Docker socket access. Grafana SHALL load its administrator password from a separate private environment file that no application process receives. Only Grafana SHALL publish a loopback-bound host port; the monitoring stack SHALL have no public Caddy route. Loki SHALL retain logs for seven days and Prometheus SHALL retain metrics for fifteen days.

#### Scenario: Operator connects through SSH

- **WHEN** an operator forwards the VM's loopback Grafana port over SSH and signs in
- **THEN** provisioned dashboards and searchable sanitized logs are available

#### Scenario: Public or unauthorized access

- **WHEN** a remote client requests the Grafana port directly or a caller scrapes metrics without the token
- **THEN** telemetry is not disclosed

#### Scenario: Grafana password isolation

- **WHEN** production Compose creates the application and monitoring services
- **THEN** only Grafana receives the administrator password from its private environment file

#### Scenario: Collector outage

- **WHEN** Alloy or Loki is unavailable
- **THEN** application requests continue and surviving bounded spooled events can be replayed when the collector recovers

### Requirement: Privacy-safe database timing

The API, worker, and collaboration processes SHALL expose separate Prometheus histograms for pooled-client acquisition and client-observed query duration when observability is enabled. Each observation SHALL use only a bounded success/failure outcome label. The metrics SHALL include successful and failed operations, including query timeouts and connection failures, without changing their results or errors. No SQL, parameters, user/course/session identifiers, arbitrary error text, or raw URLs SHALL enter metric labels or log events.

#### Scenario: Pooled and transaction queries

- **WHEN** a process executes a pool query or checks out a client for a transaction
- **THEN** each acquisition and each executed query is counted once in its respective histogram

#### Scenario: Failed database operation

- **WHEN** acquisition or a query fails, times out, or loses its connection
- **THEN** a failed-duration observation is recorded and the database error remains unchanged

#### Scenario: Disabled or failed telemetry

- **WHEN** local observability is disabled or metric recording throws
- **THEN** database results, errors, release, and transaction behavior are unaffected and no telemetry is required to complete the operation

#### Scenario: Protected process metrics

- **WHEN** API, worker, or collaboration metrics are scraped with a valid token
- **THEN** their database histograms are available after database activity; an unauthorized caller receives no metrics

### Requirement: Database latency dashboard

Grafana SHALL show p50/p95 client-observed query and acquisition duration by process, plus query and failed-query rates. The dashboard and operator documentation SHALL distinguish client-observed query duration from PostgreSQL server execution and geographic network latency.

#### Scenario: Operator diagnoses latency

- **WHEN** an operator opens the provisioned dashboard after database activity
- **THEN** database timing and HTTP latency can be compared without exposing query contents
