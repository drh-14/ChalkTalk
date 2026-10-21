# Spec Delta

## ADDED Requirements

### Requirement: Idle sessions end automatically

An active session that has had no connected participant for the configured idle period (`COLLABORATION_IDLE_END_MINUTES`, default 120) SHALL end as if ended by its creator: it becomes read-only, keeps its last persisted code and whiteboard, and leaves active lists. The collaboration server SHALL record when each session last had a connected participant, both while participants stay connected and when the last one disconnects, so the idle period survives a collaboration server restart. A session with any connected participant SHALL never end for inactivity, however long it goes without edits.

#### Scenario: A student forgets to end a session

- **WHEN** everyone leaves a session and nobody reconnects for 2 hours
- **THEN** the session ends, its post no longer shows **Live session active**, and opening it shows the final code read-only

#### Scenario: A quiet session stays open

- **WHEN** a TA keeps a session open for 3 hours without typing
- **THEN** the session stays active

### Requirement: Session creation and tickets are rate limited

Creating sessions SHALL be limited per user to `RATE_LIMIT_COLLABORATION_CREATE_USER` per hour (default 30), and requesting connection tickets SHALL be limited per user to `RATE_LIMIT_COLLABORATION_TICKET_USER` per 10 minutes (default 300). A request over a limit SHALL get `429 rate_limited` with a `Retry-After` header in seconds and SHALL have no other effect. Idempotent replays of a session creation SHALL not count against the limit. The web app SHALL show the error message when starting a session is limited.

#### Scenario: A script creates sessions in a loop

- **WHEN** one user sends a 31st session creation within an hour
- **THEN** the API returns `429 rate_limited` with `Retry-After` and creates no session

### Requirement: The collaboration server reports metrics

When observability is enabled, the collaboration server SHALL serve Prometheus metrics at `/metrics` on its own port, requiring the same `METRICS_TOKEN` bearer token as the API and worker and answering `401` without it. It SHALL report `chalktalk_collaboration_connections` (connected clients), `chalktalk_collaboration_documents` (loaded documents), `chalktalk_collaboration_store_duration_seconds` (persistence duration), `chalktalk_collaboration_rejected_updates_total`, `chalktalk_collaboration_closes_total{reason}` (connections closed by the server, by close reason), and `chalktalk_collaboration_sessions_ended_total{reason}` (`idle`). Metrics SHALL carry no user, session, or course identifiers. Prometheus SHALL scrape the collaboration server, and the Grafana dashboard SHALL show connections, store latency, and closes.

#### Scenario: An operator checks office hours load

- **WHEN** an operator opens the Grafana dashboard during office hours
- **THEN** it shows how many clients are connected to live sessions and how long stores take

### Requirement: Tests cover limits, idle ending, and metrics

API tests SHALL cover both rate limits, including `Retry-After` and that a limited request has no effect. Collaboration server tests SHALL cover idle ending after the period, that a connected session is not ended, that the idle period survives a restart, and the metrics endpoint's token check and reported series.

#### Scenario: A connected session is ended for inactivity

- **WHEN** a change ends a session that still has a connected participant
- **THEN** an automated test fails
