## MODIFIED Requirements

### Requirement: One local Compose stack

The explicit `docker compose -f deployment/local/compose.yml --env-file .env up` entry SHALL start a single local configuration containing pgvector-capable PostgreSQL, SeaweedFS, migrations, a browser-facing Caddy HTTPS gateway, the private frontend development server, API, worker, collaboration server, Prometheus, Grafana, Loki, and Alloy. Ordinary and semantic vector migrations SHALL complete before application services start. Startup SHALL leave application user and course tables empty on a new database; it SHALL NOT run a sample-data job or require a separate Compose profile or semantic-search override.

#### Scenario: Developer starts local services

- **WHEN** a developer runs the explicit local Compose command with no profile on a fresh local volume
- **THEN** the application, data services, migrations, and monitoring start from one configuration
- **AND** the browser reaches the gateway at `https://DOMAIN:WEB_PORT`
- **AND** no sample user or course is created
- **AND** the vector extension and embedding table are available

#### Scenario: Embedding provider is not configured

- **WHEN** the local stack starts without an embedding API key
- **THEN** ordinary full-text and fuzzy search remains available without external embedding requests

### Requirement: Local environment template and derived frontend URL

The canonical local environment template SHALL be `deployment/local/.env.example`, copied to the ignored repository-root `.env` before startup. It SHALL expose one `DOMAIN` hostname, not separate frontend-origin/base-URL or API-port settings. Local Compose SHALL derive the HTTPS frontend origin and base URL from `DOMAIN` and the web port. The API SHALL keep its internal port-3000 default and lower-level frontend URL overrides for direct tests and unusual deployments.

Local Compose SHALL reject a legacy `PORT` entry in its environment file before running migrations, so its API, worker, and collaboration services cannot start with a port that disagrees with the local proxy and health checks. Direct API and test runs MAY still override `PORT`.

#### Scenario: Default local host

- **WHEN** a developer copies the canonical template and runs default Compose
- **THEN** the browser origin and base URL resolve to `https://localhost:5173` and the API listens internally on port 3000

#### Scenario: Alternate local host and web port

- **WHEN** `DOMAIN=local.example.edu` and `WEB_PORT=5188` are supplied to local Compose
- **THEN** both backend frontend URLs resolve to `https://local.example.edu:5188`
- **AND** the gateway uses that hostname and port

## ADDED Requirements

### Requirement: Local HTTPS gateway

The local stack SHALL expose Caddy as the sole browser-facing application ingress at `https://DOMAIN:WEB_PORT`, defaulting to port 5173. It SHALL route `/api/health` to API `/health`, `/api/*` to the API including WebSocket upgrades, `/collaboration` to the collaboration server including WebSocket upgrades, and remaining paths and Vite HMR WebSocket upgrades to the private frontend server. The frontend server SHALL remain private HTTP, and the API SHALL trust exactly one proxy hop in local Compose. The configured local domain SHALL be allowed to access the Vite server without enabling arbitrary hostnames.

#### Scenario: API and collaboration traffic

- **WHEN** a browser makes API requests or opens Threads and collaboration WebSockets through the local origin
- **THEN** the gateway forwards each request or upgrade to the corresponding private service
- **AND** `/api/health` reports API health

#### Scenario: Frontend hot reload

- **WHEN** a developer views the app through the local HTTPS origin and edits frontend code
- **THEN** the frontend and HMR WebSocket work through that origin without connecting directly to a published Vite port

#### Scenario: Backend unavailable

- **WHEN** a backend is unavailable
- **THEN** its gateway route fails without redirecting to the frontend or bypassing TLS

### Requirement: Automatic local certificates

Local Compose SHALL generate TLS certificates on startup and preserve its local CA across ordinary restarts. It SHALL provide a way to export the CA public root for one-time host/browser trust without exporting the private key. A stale local `VITE_TLS_*` setting SHALL NOT re-enable HTTPS on the private frontend server.

#### Scenario: Fresh local stack

- **WHEN** a developer starts Compose without manually creating a certificate
- **THEN** the HTTPS gateway serves a certificate for `DOMAIN`

#### Scenario: Restart

- **WHEN** a developer restarts the stack without deleting volumes
- **THEN** the trusted local CA remains unchanged
