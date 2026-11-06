# single-vm-deployment Specification

## Purpose

Define the single-VM Compose deployment contract for a pinned ChalkTalk release.

## Requirements

### Requirement: Single-VM deployment topology

The system SHALL provide a separate Compose stack runnable on one Linux VM from a pinned source commit, with no development source mounts or mock seed. It SHALL connect to Supabase PostgreSQL and Supabase Storage rather than run local data containers, complete SQL schema migrations before compiled API, worker, and collaboration processes start, and serve the compiled browser application through Caddy. The frontend, API, Hocuspocus collaboration, and worker SHALL each have a separately named production Dockerfile; the migration job SHALL reuse the API image.

#### Scenario: Operator starts the deployment

- **WHEN** the operator supplies a valid deployment environment file and starts the deployment stack
- **THEN** migrations complete successfully before compiled application processes start
- **AND** only the Caddy frontend publishes host ports 80 and 443
- **AND** no PostgreSQL or SeaweedFS container is started in this stack
- **AND** backend processes can reach managed data services without exposing their own host ports

### Requirement: HTTPS and same-origin routing

Caddy SHALL obtain HTTPS certificates for the configured domain, serve the compiled SPA, proxy `/api/v1` to the API without path changes, map `/api/health` to the API `/health` endpoint, and proxy `/collaboration` WebSockets.

#### Scenario: Browser uses the deployed application

- **WHEN** a browser visits the configured HTTPS domain and calls an API or collaboration endpoint
- **THEN** static assets, API requests, and WebSocket connections use the same public origin

### Requirement: Email and storage configuration

The deployment SHALL configure existing mail code for Resend HTTPS and the existing server-side S3 client for a private Supabase Storage bucket. It SHALL NOT expose database or S3 credentials to the browser or send test mail automatically.

#### Scenario: Operator fills credentials

- **WHEN** Resend and Supabase credentials are supplied in the ignored deployment environment file
- **THEN** API, worker, collaboration, and migration processes use the configured managed database, and API and worker use Supabase Storage
- **AND** the frontend image and browser do not receive those secrets

### Requirement: Explicit managed data mode

The production Compose stack SHALL be located in `deployment/production/`, run application processes with `NODE_ENV=production`, and require the existing managed PostgreSQL, S3, and Resend endpoint/credential variables. It SHALL not use custom `PRODUCTION`, `PROD`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` selectors. A managed `DATABASE_URL` SHALL specify exactly one TLS mode (`sslmode=require`, `verify-ca`, or `verify-full`). Missing or disabled TLS SHALL fail startup.

#### Scenario: Managed database settings are missing

- **WHEN** a production process starts without a valid remote `DATABASE_URL`
- **THEN** it fails before serving work

#### Scenario: Managed storage settings are missing

- **WHEN** a production process starts without valid `S3_*` settings
- **THEN** it fails before serving work

#### Scenario: Legacy selector is present

- **WHEN** a removed custom mode selector is present
- **THEN** startup fails with guidance to remove it

#### Scenario: Local startup

- **WHEN** a local process starts without `NODE_ENV=production`
- **THEN** local PostgreSQL and SeaweedFS rules remain in effect
