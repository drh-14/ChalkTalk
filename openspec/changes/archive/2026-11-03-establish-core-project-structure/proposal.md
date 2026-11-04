## Why

ChalkTalk currently has its product and architecture documentation but no runnable application foundation. Establishing a small local foundation now lets later feature changes build on a consistent frontend, HTTP service, and database setup.

## What Changes

- Add an npm TypeScript workspace with a React browser application and an Express HTTP API.
- Add a local PostgreSQL service, SQL migration tooling, and documented environment configuration.
- Provide a health endpoint and local development workflow that verifies the web application, API, and database can run together.
- Add shared quality scripts for formatting, linting, type checking, testing, and production builds.

## Capabilities

### New Capabilities

- `core-project-foundation`: A runnable local foundation that exposes API health, applies database migrations, and supports browser-to-API development.

### Modified Capabilities

- None.

## Impact

- Adds root workspace configuration, `apps/web`, `apps/api`, `database/migrations`, local Docker Compose configuration, and setup documentation.
- Adds Node.js dependencies for React, Vite, Express, PostgreSQL access, TypeScript, tests, linting, and formatting.
- Does not add domain data, authentication, background processing, collaboration, object storage, email, or cloud deployment.
