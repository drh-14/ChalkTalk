# local-compose-deployment Specification

## Purpose

Provide a reproducible single-Compose local development stack with the database capabilities and named process images needed by ChalkTalk.

## Requirements

### Requirement: One local Compose stack

The root `docker compose up` entry SHALL start a single local configuration containing pgvector-capable PostgreSQL, SeaweedFS, migrations, the frontend, API, worker, collaboration server, and local monitoring. Ordinary and semantic vector migrations SHALL complete before application services start. Startup SHALL leave application user and course tables empty on a new database; it SHALL NOT run a sample-data job or require a separate Compose profile or semantic-search override.

#### Scenario: Developer starts local services

- **WHEN** a developer runs `docker compose up` with no profile on a fresh local volume
- **THEN** the application, data services, migrations, and monitoring start from one configuration
- **AND** no sample user or course is created
- **AND** the vector extension and embedding table are available

#### Scenario: Embedding provider is not configured

- **WHEN** the local stack starts without an embedding API key
- **THEN** ordinary full-text and fuzzy search remains available without external embedding requests

### Requirement: Named development Dockerfiles

The local stack SHALL build the API, worker, collaboration server, and frontend from separately named local Dockerfiles. The migration job SHALL reuse the API Dockerfile.

#### Scenario: Operator resolves the local Compose configuration

- **WHEN** the operator inspects the resolved default configuration
- **THEN** each application process references its corresponding named Dockerfile
- **AND** migration references the API Dockerfile
