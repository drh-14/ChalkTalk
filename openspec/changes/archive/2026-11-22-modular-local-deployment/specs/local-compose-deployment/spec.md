## MODIFIED Requirements

### Requirement: One local Compose stack

`deployment/local/start.sh` SHALL start the local application and existing monitoring/gateway services using independently selected bundled PostgreSQL and SeaweedFS. `LOCAL_DATABASE_ENABLED` and `LOCAL_OBJECT_STORE_ENABLED` SHALL each default to the literal `true`, accept only `true` or `false`, and select topology only. All four combinations SHALL work; application processes SHALL receive resolved connections rather than interpret those flags. No startup SHALL seed, reset, copy, or delete data. Existing HTTPS gateway, private application listeners, semantic-search fallback without an embedding key, and named process Dockerfiles SHALL remain intact.

#### Scenario: Independent topology matrix

- **WHEN** each of `(true,true)`, `(true,false)`, `(false,true)`, and `(false,false)` is started with complete selected connections
- **THEN** only the selected bundled data services start and every application process connects to the selected database and store
- **AND** a fresh database contains no sample users or courses

#### Scenario: Defaults and invalid flags

- **WHEN** flags are absent
- **THEN** both bundled services are selected
- **WHEN** a flag is empty or any value other than `true` or `false`
- **THEN** startup fails before any build, resource creation, service start, migration, or bucket operation

#### Scenario: Developer starts local services
- **WHEN** a developer runs the launcher with default flags on fresh local volumes and valid configuration
- **THEN** applications, bundled data services, ordinary and semantic migrations, gateway and monitoring start without sample users or courses
- **AND** the browser origin is `https://DOMAIN:WEB_PORT`

#### Scenario: Embedding provider is not configured
- **WHEN** the local stack starts without an embedding API key
- **THEN** ordinary full-text and fuzzy search remains available without external embedding requests

### Requirement: Local environment template and derived frontend URL

The canonical local environment template and operator documentation SHALL live under `deployment/local/`. The launcher SHALL use a single explicitly selected environment file (default `deployment/local/.env`) with documented deterministic precedence, using a safe restricted literal `KEY=value` parser, never source/eval. Unsupported syntax, quoting/expansion, duplicates and malformed lines SHALL be rejected rather than interpreted. It SHALL retain `DOMAIN` and `WEB_PORT` derived HTTPS URLs and internal API port 3000. It SHALL reject legacy `PORT` before any mutation; direct API/test port overrides SHALL remain supported. Configuration SHALL be validated from original operator inputs before generating internal `DATABASE_URL` or `S3_*` values.

#### Scenario: Alternate local origin

- **WHEN** `DOMAIN=local.example.edu` and `WEB_PORT=5188` are supplied
- **THEN** the gateway and backend frontend URLs resolve consistently to `https://local.example.edu:5188`

#### Scenario: Legacy or unsafe configuration

- **WHEN** the operator supplies `PORT`, an invalid domain/URL/port, missing required secret, or malformed env input
- **THEN** startup fails before mutation with actionable variable-name diagnostics and without printing credentials, connection URLs, tokens, or raw provider responses

#### Scenario: Default local host
- **WHEN** the developer configures the canonical local template and runs the launcher with default host settings
- **THEN** frontend origin/base URL is `https://localhost:5173` and API listens internally on port 3000

#### Scenario: Alternate local host and web port
- **WHEN** `DOMAIN=local.example.edu` and `WEB_PORT=5188` are supplied
- **THEN** both backend frontend URLs resolve to `https://local.example.edu:5188` and the gateway uses that hostname/port

### Requirement: Canonical local Compose entry point

The launcher SHALL explicitly select its Compose files, environment file, project directory, project name, and allowed topology profiles. Inherited `COMPOSE_FILE`, `COMPOSE_PROFILES`, and implicit override/env discovery SHALL NOT alter topology. The default project SHALL remain `chalktalk`, retaining existing named-volume identities; an explicit launcher project option SHALL allow isolated tests/worktrees. Default database and store host ports SHALL be unpublished; any requested publication SHALL bind only loopback and use a valid port. Local deployment artifacts SHALL remain under `deployment/local/`; no root Compose file SHALL be required. Existing Dockerfile-specific secret/build-context exclusions SHALL remain effective.

#### Scenario: Restart and hostile inherited Compose values

- **WHEN** the launcher restarts an existing project from another working directory with inherited unrelated Compose files/profiles
- **THEN** only explicitly selected services/configuration are used and existing database, object, and CA volumes remain attached without reset or removal

#### Scenario: Optional host publication

- **WHEN** valid optional database/store host ports are configured
- **THEN** only enabled bundled services publish those ports on loopback
- **AND** absent port settings publish neither data service

#### Scenario: Existing local data remains attached
- **WHEN** the developer starts the launcher without an explicit project override
- **THEN** the project remains `chalktalk` and existing `chalktalk_*` named volumes remain attached

#### Scenario: Isolated build
- **WHEN** an application image is built with its deployment Dockerfile
- **THEN** its context excludes env credentials, Git metadata, dependencies and other worktrees

## ADDED Requirements

### Requirement: Original-input preflight before mutations

Startup SHALL require only Docker/Compose and standard shell tools on the deployment host, not Node/npm/application dependencies or a host SDK. Phase 1 SHALL deterministically validate original static configuration before generating internal settings or any build/pull/create/start/migration/bucket/provider request: flags, connection syntax within documented supported URL grammar, local/external conflicts, provider exclusivity, sender, required secrets, ports, credential MODE and unsupported legacy selectors. It SHALL NOT attempt to establish credential validity/permissions, network reachability or schema compatibility in phase 1. A read-only explicit Compose render SHALL NOT output secrets. Shell and application static validators SHALL agree on supported acceptance/rejection fixtures. With bundled database selected, ANY populated supported external database setting (currently `DATABASE_URL`) SHALL fail, even if invalid or partial. With external database selected, a complete valid PostgreSQL connection SHALL be required with no bundled fallback. Secrets SHALL NOT be exposed by diagnostics, shell tracing, or printed resolved Compose configuration.

#### Scenario: Partial external database conflict

- **WHEN** bundled PostgreSQL is selected and `DATABASE_URL` contains any non-whitespace value
- **THEN** startup fails before mutation rather than overwriting that input

#### Scenario: Invalid configuration has no side effects

- **WHEN** any static configuration field is invalid, including a partial other-provider or external-store field
- **THEN** no build/pull/create/start, schema change, bucket creation, or provider request occurs
- **AND** diagnostics identify the offending setting and corrective action without its value

#### Scenario: Restricted literal parsing and host prerequisites

- **WHEN** valid literal inputs are supplied on a host with Docker/Compose and standard shell tools but without Node/npm/SDK dependencies
- **THEN** phase 1 can complete and transition to containerized runtime checks
- **WHEN** operator input contains unsupported syntax, substitution, duplicate keys or malformed assignments
- **THEN** it is rejected without execution or deployment mutations

#### Scenario: Runtime failure after static acceptance

- **WHEN** static configuration passes but containerized checks find unavailable credentials, denied access, unreachable services or incompatible schema
- **THEN** container creation may already have occurred but traffic and worker claims remain disabled
- **AND** no unauthorized schema/bucket provisioning or destructive cleanup occurs, and diagnostics are redacted

### Requirement: Migration ownership and external consent

Bundled PostgreSQL startup SHALL complete tracked ordinary and semantic migrations before applications start. External database startup SHALL perform a read-only compatibility check by default and refuse startup when ordinary migrations are pending, including an absent migration ledger, without creating any table or changing schema. An explicit per-invocation acknowledgment SHALL permit ordinary external migrations for that invocation only; persisted environment configuration SHALL NOT grant this consent. External semantic provisioning SHALL remain a documented explicit prerequisite when semantic search is configured, never an implicit startup mutation. Migration failure SHALL prevent application startup.

#### Scenario: Bundled schema initialization and repeat startup

- **WHEN** a bundled database is started fresh and then restarted
- **THEN** ordinary and semantic changes are tracked and applied once, with compatible existing semantic objects adopted safely rather than reset

#### Scenario: External schema pending without acknowledgment

- **WHEN** external schema has pending migrations and the invocation has no acknowledgment
- **THEN** startup refuses, reports pending migration identifiers safely, and schema and migration ledger remain unchanged

#### Scenario: Explicit ordinary migration consent

- **WHEN** the operator acknowledges external migrations for this invocation
- **THEN** ordinary migrations run before applications start but external semantic objects are not provisioned implicitly
- **AND** a later invocation again defaults to read-only compatibility checking

#### Scenario: Missing external semantic prerequisite

- **WHEN** semantic search is configured against external PostgreSQL without its required vector capability/schema
- **THEN** startup refuses with explicit provisioning guidance without attempting semantic DDL
