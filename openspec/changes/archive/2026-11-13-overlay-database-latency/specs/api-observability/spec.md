## MODIFIED Requirements

### Requirement: Database latency dashboard

Grafana SHALL show p50/p95 client-observed query and acquisition duration by process, plus database attempt rate and failure fraction. Attempts SHALL count executed queries and failed pool acquisitions, without double-counting successful acquisitions. Each p50 and p95 latency panel SHALL overlay completed HTTP request latency, database query duration, and database pool acquisition duration on a shared seconds scale, with distinct legends identifying the measurement and database process. The dashboard and operator documentation SHALL distinguish client-observed query duration from PostgreSQL server execution and geographic network latency.

#### Scenario: Operator diagnoses latency

- **WHEN** an operator opens the provisioned dashboard after database activity
- **THEN** the p50 and p95 panels each display HTTP latency alongside database query duration and pool wait by process without exposing query contents

## ADDED Requirements

### Requirement: Critical endpoint latency charts

For the four fixed API operations login (`POST /api/v1/sessions`), course creation (`POST /api/v1/organizations/:organizationId/courses`), notification list (`GET /api/v1/users/me/notifications`), and notification unread count (`GET /api/v1/users/me/notifications/unread-count`), the API SHALL observe the sum of all instrumented query durations and the sum of all pool-acquisition durations incurred during each request, including authentication work. It SHALL record one sample of each total per completed or aborted request, including zero when no database operation occurred, without changing the existing process-wide database metrics. The totals SHALL include failed operations and SHALL stop accumulating after the response finishes or closes. Only the fixed operation key and completed/aborted outcome SHALL label the totals; no SQL text, user or organization identifier, raw URL, or query parameter SHALL be recorded. Telemetry errors SHALL not affect request or database behavior.

Grafana SHALL provide three endpoint charts: login, course creation, and notification fetching. Each SHALL show p50 and p95 completed HTTP request duration, per-request query total, and per-request pool-acquisition total in seconds; the notification chart SHALL distinguish list and unread-count operations. The dashboard and operator documentation SHALL explain that summed query and checkout durations may overlap and can exceed HTTP wall-clock duration, and that they do not isolate PostgreSQL server execution or the HTTP critical path.

#### Scenario: Operator diagnoses a critical endpoint

- **WHEN** an operator opens the provisioned dashboard after requests to these endpoints
- **THEN** the three endpoint charts display HTTP, query-total, and pool-total p50 and p95 for the matching operations without showing individual organization or user identifiers

#### Scenario: No database work or failed database operation

- **WHEN** a selected request performs no instrumented database operation, or an instrumented operation fails
- **THEN** it contributes zero totals in the former case and elapsed time of the failed operation in the latter case, without changing the request result or error

#### Scenario: Abort or late database work

- **WHEN** a selected request closes before finishing or database work settles after its response closes
- **THEN** the request totals are recorded once as aborted and late work is excluded from those totals while existing process-wide database metrics remain unchanged
