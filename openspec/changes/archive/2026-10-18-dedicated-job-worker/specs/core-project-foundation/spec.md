## ADDED Requirements

### Requirement: Dedicated background job process

The system SHALL provide documented commands to start the browser, HTTP API, PostgreSQL, and a separate background job worker. The API SHALL not claim background jobs. The local `app` Compose profile SHALL start the worker automatically after migrations; the dependency-only profile SHALL not start it.

#### Scenario: API stays available without worker
- **WHEN** the HTTP API runs while the worker process is stopped
- **THEN** requests can still be served and queued jobs remain pending

#### Scenario: Worker starts and restarts
- **WHEN** a worker starts against the migrated PostgreSQL queue
- **THEN** it claims and processes queued jobs independently of the API
- **AND** jobs remaining after worker exit can be processed on restart

#### Scenario: Worker shuts down gracefully
- **WHEN** a termination signal arrives during a job
- **THEN** the worker stops taking new jobs, waits for the current attempt to settle, and closes its database connections
