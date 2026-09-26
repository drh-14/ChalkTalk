## Context

See [proposal.md](proposal.md) for the motivation. The repository contains product, API, database, and architecture documentation but no runnable application code. The approved initial scope is limited to a browser shell, HTTP API, local PostgreSQL, and migration tooling.

## Goals / Non-Goals

**Goals:**

- Create independently runnable web and API applications in an npm workspace.
- Keep PostgreSQL schema changes reviewable as ordered raw SQL migrations.
- Keep browser calls same-origin in local development through a Vite proxy.
- Make quality checks available from the repository root.

**Non-Goals:**

- Authentication, application-domain tables, or feature endpoints.
- Worker, Hocuspocus, object-store, email, search, and AWS services.
- Production deployment automation or a shared package abstraction.

## Decisions

### Use npm workspaces with `apps/web` and `apps/api`

The web application and Express API are independently deployable processes, so each owns its runtime configuration and dependencies. The root coordinates common scripts. A `packages/` directory is deliberately omitted because no code is shared yet; database access remains inside the API until another service needs it.

### Use React with Vite for the browser shell

Vite supplies a small TypeScript development and build setup for the planned React client. The shell remains intentionally minimal. A larger frontend framework would add routing and server-rendering decisions outside this change.

### Use Express with a composable application module

`app.ts` constructs the Express application while `server.ts` starts the network listener. This makes the health endpoint directly testable without binding a real port. Express is the documented web-server technology and will later own HTTP concerns such as sessions and authorization.

### Use raw SQL files and a minimal migration runner

Migrations live in `database/migrations` as ordered `.sql` files. The runner creates a migration ledger, reads unapplied files in lexicographic order, and records each within the same transaction as its SQL. Raw SQL keeps the database schema explicit and matches the existing SQL-oriented schema documentation. An ORM was rejected because it adds a data-model abstraction before the application has domain code.

### Run PostgreSQL in Docker Compose and application processes directly

Docker Compose runs only PostgreSQL and a named local data volume. Vite and Express run directly with npm scripts for fast reload and clear debugging. Containerizing all application processes can be added with the managed/self-hosted deployment change.

### Proxy `/api` from Vite to Express in development

Vite forwards `/api` to the API's local port. This keeps browser requests same-origin in development and gives future cookie-based authentication the correct boundary without adding CORS configuration now.

## Risks / Trade-offs

- [Local PostgreSQL requires Docker] → Document the Docker prerequisite and expose separate web/API commands for work that does not need database access.
- [The migration runner is intentionally small] → Use it only for ordered project migrations; introduce richer migration features only when requirements justify them.
- [The health endpoint does not establish database readiness] → Keep it process-only for this foundation; add dependency health behavior when operational requirements are defined.

## Migration Plan

1. Install the workspace dependencies.
2. Copy `.env.example` to `.env` and start PostgreSQL with Docker Compose.
3. Run the migration script before starting feature work that requires database state.
4. Roll back this foundation by stopping and removing the local Compose volume; project source changes remain reversible through version control.
