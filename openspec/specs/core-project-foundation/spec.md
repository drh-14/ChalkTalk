# core-project-foundation Specification

## Purpose

Provide a small, reliable local runtime foundation so later ChalkTalk capabilities can use a browser client, HTTP API, and PostgreSQL database consistently.

## Requirements

### Requirement: Local development foundation

The system SHALL provide documented commands to start the browser application, HTTP API, and local PostgreSQL service for development. The default Compose invocation SHALL start dependency services only. An opt-in `app` Compose profile SHALL start a hot-reloading browser application, a hot-reloading HTTP API, and an idempotent migration service; the API SHALL not be published directly to the host and SHALL start only after the migration service completes successfully.

#### Scenario: Developer starts dependency services only

- **WHEN** a developer runs `docker compose up -d` without the `app` profile
- **THEN** PostgreSQL and SeaweedFS start
- **AND** the migration, API, and browser application services do not start

#### Scenario: Developer starts the local foundation

- **WHEN** a developer follows the documented local setup steps with the required environment configuration
- **THEN** the browser application, HTTP API, and PostgreSQL service are available locally

#### Scenario: Developer starts the complete containerized foundation

- **WHEN** a developer follows the documented certificate and environment setup and runs `docker compose --profile app up --build`
- **THEN** PostgreSQL becomes healthy
- **AND** migrations complete before the API starts
- **AND** the browser application is available through HTTPS on the documented host port
- **AND** the API is reachable only through the browser application's `/api` proxy

#### Scenario: Dependencies change after a prior container start

- **WHEN** a developer starts the `app` profile with an existing application dependency volume whose Node runtime or `package-lock.json` fingerprint differs from the current source
- **THEN** the affected application service refreshes that dependency volume before executing its command
- **AND** the PostgreSQL data volume remains intact

#### Scenario: Browser application restarts after dependency repair

- **WHEN** the browser application's dependency volume is refreshed after a prior container start
- **THEN** its Compose health check remains unhealthy until HTTPS `/api/health` is successfully proxied to the internal API
- **AND** automation can wait for that health condition before exercising the browser endpoint

### Requirement: API health status

The HTTP API SHALL expose `GET /health`, which returns HTTP 200 and a JSON body containing `status` with the value `ok` when the API process is running.

#### Scenario: API process is healthy

- **WHEN** a client requests `GET /health` from a running API process
- **THEN** the response has HTTP 200 and contains `{ "status": "ok" }`

### Requirement: Database migration tracking

The system SHALL apply ordered SQL migrations to the configured PostgreSQL database and record completed migrations so a migration is not applied more than once.

#### Scenario: New database receives migrations

- **WHEN** the migration command runs against a database that has not received the project migrations
- **THEN** each available migration is applied in filename order and recorded as completed

#### Scenario: Existing database receives migrations again

- **WHEN** the migration command runs against a database where all project migrations are recorded as completed
- **THEN** it completes without applying a migration again

### Requirement: Browser API forwarding in development

The browser development server SHALL forward requests whose path begins with `/api` to the local HTTP API. The forwarding target SHALL default to the host-local API address and SHALL be configurable for the containerized application workflow without changing browser request paths.

#### Scenario: Browser client calls the API during development

- **WHEN** the browser application requests an `/api` path through its development server
- **THEN** the request is forwarded to the local HTTP API without requiring a separate browser origin configuration

#### Scenario: Browser client calls the API during direct development

- **WHEN** the browser application requests an `/api` path through its development server without a configured proxy override
- **THEN** the request is forwarded to the host-local HTTP API without requiring a separate browser origin configuration

#### Scenario: Browser client calls the API during containerized development

- **WHEN** the browser application requests an `/api` path through the containerized development server with its configured proxy override
- **THEN** the request is forwarded to the internal HTTP API service without exposing that service directly to the host

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
