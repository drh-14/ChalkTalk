## Purpose

Provides local operators with API and background-job latency, reliability, and privacy-safe logs without making application availability depend on collection.

## ADDED Requirements

### Requirement: Request metrics and protected scrape

The API SHALL expose Prometheus request counts and duration histograms using only bounded method, matched route template, status class, and outcome labels. Buckets SHALL include 0.2 seconds. The metrics endpoint SHALL exist only when enabled and SHALL require a configured bearer token; health and scrape traffic SHALL not distort application latency.

#### Scenario: Authenticated scrape

- **WHEN** a caller presents the correct bearer token to an enabled `/metrics`
- **THEN** Prometheus-format request and process metrics are returned

#### Scenario: Unauthorized or disabled scrape

- **WHEN** the token is absent or invalid, or observability is disabled
- **THEN** no metrics are disclosed

#### Scenario: Sensitive or unmatched path

- **WHEN** a request URL contains an identifier or query, or no route matches
- **THEN** no raw path, identifier, or query is used in a metric label

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

When enabled, the API and dedicated worker SHALL each append sanitized NDJSON to separate local spools, rotate files at approximately 16 MiB, cap storage at 256 MiB, evict oldest segments and count capacity-evicted events separately from confirmed pre-persistence drops, and continue serving if the collector or disk fails. The delivery status of an evicted event SHALL be reported as unknown rather than definite loss. Logstash SHALL tail both spools with persistent checkpoints and a persistent bounded queue, then index into Elasticsearch. Elasticsearch-indexed logs and both spools SHALL have seven-day age retention; metric samples SHALL be retained for fifteen days. API and worker Docker stdout SHALL use size/count-bounded local logging with no seven-day age guarantee, so it may contain older events. Spooling SHALL not await the collector in a request.

#### Scenario: Collector outage and recovery

- **WHEN** Logstash or Elasticsearch is temporarily unavailable
- **THEN** API requests continue and surviving spooled events are available for replay on recovery

#### Scenario: Capacity or disk failure

- **WHEN** the spool reaches its cap or cannot be written
- **THEN** API requests still succeed and stdout continues; capacity eviction increments an at-risk event counter, while a rejected or failed spool write increments a definite-drop or error counter

#### Scenario: Docker stdout rotation

- **WHEN** local Compose runs the API and worker
- **THEN** each container's stdout log uses bounded local file rotation independent of the seven-day Elasticsearch and spool age limits

### Requirement: Opt-in local monitoring page

A local Compose observability profile SHALL run Prometheus, Grafana, Logstash, and Elasticsearch. Prometheus SHALL scrape the API and worker every 60 seconds. Only credential-protected Grafana SHALL publish a localhost-bound host port. Provisioned Grafana data sources and dashboards SHALL show traffic, errors, p50/p95/p99 latency, 200 ms compliance, worker outcomes and duration, scrape health, confirmed spool drops, capacity-evicted events with unknown delivery status, and searchable logs. No application monitoring page or alert delivery is included.

#### Scenario: Operator dashboard

- **WHEN** the opt-in profile is started with required credentials
- **THEN** an operator can open localhost Grafana and inspect provisioned metrics and logs
