# core-project-foundation Specification

## Purpose
Provide a small, reliable local runtime foundation so later ChalkTalk capabilities can use a browser client, HTTP API, and PostgreSQL database consistently.

## Requirements

### Requirement: Local development foundation

The system SHALL provide documented commands to start the browser application, HTTP API, and local PostgreSQL service for development.

#### Scenario: Developer starts the local foundation

- **WHEN** a developer follows the documented local setup steps with the required environment configuration
- **THEN** the browser application, HTTP API, and PostgreSQL service are available locally

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

The browser development server SHALL forward requests whose path begins with `/api` to the local HTTP API.

#### Scenario: Browser client calls the API during development

- **WHEN** the browser application requests an `/api` path through its development server
- **THEN** the request is forwarded to the local HTTP API without requiring a separate browser origin configuration
