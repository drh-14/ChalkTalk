# local-compose-deployment Specification

## Purpose
Provide a reproducible single-Compose local development stack with the database capabilities and named process images needed by ChalkTalk.

## Requirements

### Requirement: One local Compose stack

The root `docker compose` entry SHALL include one local Compose configuration. That configuration SHALL run a pgvector-capable PostgreSQL image and SHALL apply both ordinary and semantic vector migrations before application services start. It SHALL NOT require a separate semantic-search Compose override.

#### Scenario: Developer starts local services

- **WHEN** a developer starts the root Compose stack with the app profile
- **THEN** PostgreSQL, SeaweedFS, migrations, and the application services use the single local configuration
- **AND** the vector extension and embedding table are available

#### Scenario: Embedding provider is not configured

- **WHEN** the local stack starts without an embedding API key
- **THEN** ordinary full-text and fuzzy search remains available without external embedding requests

### Requirement: Named development Dockerfiles

The local stack SHALL build the API, worker, collaboration server, and frontend from separately named local Dockerfiles. The migration and seed jobs SHALL reuse the API Dockerfile.

#### Scenario: Operator resolves the local Compose configuration

- **WHEN** the operator inspects the resolved app-profile configuration
- **THEN** each application process references its corresponding named Dockerfile
- **AND** migration and seed reference the API Dockerfile
