## ADDED Requirements

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

Grafana SHALL show p50/p95 client-observed query and acquisition duration by process, plus database attempt rate and failure fraction. Attempts SHALL count executed queries and failed pool acquisitions, without double-counting successful acquisitions. The dashboard and operator documentation SHALL distinguish client-observed query duration from PostgreSQL server execution and geographic network latency.

#### Scenario: Operator diagnoses latency

- **WHEN** an operator opens the provisioned dashboard after database activity
- **THEN** database timing and HTTP latency can be compared without exposing query contents
