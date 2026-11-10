## MODIFIED Requirements

### Requirement: One local Compose stack

The explicit `docker compose -f deployment/local/compose.yml --env-file .env up` entry SHALL start a single local configuration containing pgvector-capable PostgreSQL, SeaweedFS, migrations, the frontend, API, worker, collaboration server, Prometheus, Grafana, Loki, and Alloy. Ordinary and semantic vector migrations SHALL complete before application services start. Startup SHALL leave application user and course tables empty on a new database; it SHALL NOT run a sample-data job or require a separate Compose profile or semantic-search override.

#### Scenario: Developer starts local services

- **WHEN** a developer runs the explicit local Compose command with no profile on a fresh local volume
- **THEN** the application, data services, migrations, and monitoring start from one configuration
- **AND** no sample user or course is created
- **AND** the vector extension and embedding table are available

#### Scenario: Embedding provider is not configured

- **WHEN** the local stack starts without an embedding API key
- **THEN** ordinary full-text and fuzzy search remains available without external embedding requests

## ADDED Requirements

### Requirement: Local environment template and derived frontend URL

The canonical local environment template SHALL be `deployment/local/.env.example`, copied to the ignored repository-root `.env` before startup. It SHALL expose one `DOMAIN` hostname, not separate frontend-origin/base-URL or API-port settings. Local Compose SHALL derive the HTTPS frontend origin and base URL from `DOMAIN` and the web port. The API SHALL keep its internal port-3000 default and lower-level frontend URL overrides for direct tests and unusual deployments.

#### Scenario: Default local host

- **WHEN** a developer copies the canonical template and runs default Compose
- **THEN** the browser origin and base URL resolve to `https://localhost:5173` and the API listens internally on port 3000

#### Scenario: Alternate local host and web port

- **WHEN** `DOMAIN=local.example.edu` and `WEB_PORT=5188` are supplied to local Compose
- **THEN** both backend frontend URLs resolve to `https://local.example.edu:5188`

### Requirement: Explicit course population

Local startup SHALL NOT offer a mock-data environment switch or automatic demo seeder. Operators MAY populate courses through the explicit Piazza import command. Dedicated seed modules from the previous startup design SHALL not remain in the application build.

#### Scenario: Fresh startup

- **WHEN** the local stack starts on a new database
- **THEN** no users or courses are created until an operator uses the app or the Piazza import command

### Requirement: Canonical local Compose entry point

The local stack SHALL be invoked with `deployment/local/compose.yml` explicitly; no root-level Compose file or root-level Docker ignore file SHALL be required. The local Compose project SHALL default to `chalktalk` so existing named volumes keep their identity, while `COMPOSE_PROJECT_NAME` MAY isolate test/worktree stacks. Each local and production Dockerfile SHALL have specific ignore rules excluding secrets, `.git`, dependency directories, and other worktrees from its root build context while allowing safe env templates.

#### Scenario: Existing local data remains attached

- **WHEN** a developer runs the explicit local Compose command without a project override
- **THEN** the project remains `chalktalk` and existing `chalktalk_*` named volumes remain attached

#### Scenario: Isolated build

- **WHEN** a developer builds an application image with a deployment Dockerfile
- **THEN** the build context excludes env credentials, Git metadata, installed dependencies, and other worktrees
