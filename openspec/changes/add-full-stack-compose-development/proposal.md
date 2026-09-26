## Why

The local Compose file currently starts only PostgreSQL and Mailpit. Developers who want the entire application running must start migrations, the API, and Vite independently. A full-stack, hot-reloading Compose workflow makes a fresh local environment runnable with one command while retaining the existing dependency-only workflow.

## What Changes

- Add an opt-in `app` Compose profile for the Vite web server, Express API, and an idempotent one-shot migration service.
- Keep the default Compose invocation limited to PostgreSQL and Mailpit.
- Run the web and API source through development watchers in Node 22 containers, using source mounts and named dependency volumes.
- Make the Vite API-proxy target configurable so the web container can reach the internal API service without publishing the API port.
- Document the two local workflows and add CI smoke coverage for the containerized HTTPS proxy and migrations.

## Capabilities

### New Capabilities

- `full-stack-compose-development`: An opt-in, hot-reloading Compose profile that serves the browser application over locally trusted HTTPS and proxies it to an internal API after migrations complete.

### Modified Capabilities

- `core-project-foundation`: Local development supports both dependency-only and complete containerized application workflows.

## Impact

- Updates `docker-compose.yml`, Vite configuration, root ignore/configuration files, README, and CI.
- Adds a development-only Dockerfile and Compose smoke test coverage.
- Does not create a production image, change application API contracts, or replace direct `npm run dev` development.
