# single-vm-deployment Specification

## Purpose

Define the single-VM Compose deployment contract for a pinned ChalkTalk release.

## Requirements

### Requirement: Single-VM deployment topology

The system SHALL provide a separate Compose stack runnable on one Linux VM from a pinned source commit, with no development source mounts or mock seed. It SHALL start PostgreSQL and SeaweedFS with persistent volumes, complete migrations before the compiled API/worker/collaboration processes start, and serve the compiled browser application through Caddy.

#### Scenario: Operator starts the deployment

- **WHEN** the operator supplies a valid deployment environment file and starts the deployment stack
- **THEN** the migration service completes successfully before the compiled application processes start
- **AND** only Caddy publishes host ports 80 and 443
- **AND** API, database, and object storage are reachable only on internal Compose networking

### Requirement: HTTPS and same-origin routing

Caddy SHALL obtain HTTPS certificates for the configured domain, serve the compiled SPA, proxy `/api/v1` to the API without path changes, map `/api/health` to the API `/health` endpoint, and proxy `/collaboration` WebSockets.

#### Scenario: Browser uses the deployed application

- **WHEN** a browser visits the configured HTTPS domain and calls an API or collaboration endpoint
- **THEN** static assets, API requests, and WebSocket connections use the same public origin

### Requirement: Email and storage configuration

The deployment SHALL configure existing mail code for AWS SES SMTP over TLS port 465 and existing object storage code for internal SeaweedFS. It SHALL NOT send test mail automatically.

#### Scenario: Operator fills credentials

- **WHEN** SES and SeaweedFS credentials are supplied in the ignored deployment environment file
- **THEN** API and worker receive the matching SMTP and S3 settings without publishing internal services
