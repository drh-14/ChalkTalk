## Context

The current project uses Docker Compose for PostgreSQL and Mailpit, while the API and Vite server run directly on the host. Authentication uses secure browser cookies, so the local browser entry point must remain HTTPS with a certificate trusted by the host browser. The approved design keeps the existing direct-development workflow and adds an opt-in full-stack profile.

## Goals / Non-Goals

**Goals:**

- Start the full local application with `docker compose --profile app up --build`.
- Keep source hot reload for Vite and the API inside Node 22 development containers.
- Apply migrations exactly once per Compose run before the API becomes available.
- Preserve HTTPS at `https://localhost:5173` and same-origin `/api` forwarding.
- Exercise the complete container wiring in CI.

**Non-Goals:**

- Build or publish production application images.
- Automatically trust a local certificate authority on the developer host.
- Publish the API directly to the host or replace the direct `npm run dev` workflow.

## Decisions

### Use an opt-in `app` Compose profile

The unprofiled Compose command remains a fast dependency-only workflow. The `app` profile adds `migrate`, `api`, and `web`, enabling a deliberate one-command full stack without requiring Docker for every edit/test loop.

### Use one development image, source mounts, and named dependency volumes

`Dockerfile.dev` uses Node 22 and installs the workspace dependencies. Each application service mounts the repository source and receives a service-specific named `node_modules` volume. This keeps host modules out of Linux containers while preserving watcher behavior. Before each container command, a small entrypoint compares a fingerprint of the Node runtime and `package-lock.json` to the volume marker. A changed or missing fingerprint runs `npm ci` and records the new marker, so a stale dependency volume cannot mask rebuilt dependencies. It does not affect the PostgreSQL data volume. Vite uses polling only when running in Compose, where host filesystem events can be unreliable.

### Gate the internal API on a one-shot migration service

`postgres` has a `pg_isready` health check. The `migrate` service waits for that condition, runs the existing migration command, and exits successfully. The API depends on the migration service completing successfully. Migration tracking makes reruns safe; a failed migration leaves the API unavailable instead of serving an old schema.

### Keep the API private and proxy from the HTTPS web service

The API exposes port 3000 only on the Compose network. The web service publishes HTTPS port 5173 and uses `VITE_API_PROXY_TARGET=http://api:3000`; Vite forwards `/api` unchanged. The default proxy target remains `http://localhost:3000` for direct host development. Certificates generated with `mkcert` remain host-owned files mounted read-only into the web container.

### Verify container wiring in a distinct CI job

The existing verification job continues to run unit, integration, and build checks. A separate Compose smoke job confirms the safe, tracked `.env.example` template is present while real `.env` files remain ignored, copies that template into an ephemeral `.env`, generates a temporary self-signed certificate, validates the rendered Compose configuration, starts the `app` profile, waits for services, requests the proxied HTTPS health endpoint, proves migrations recorded their ledger, then emits logs and removes resources. The web service declares healthy only after its internal HTTPS `/api/health` proxy responds; its probe alone disables certificate validation so the CI-only self-signed certificate does not alter browser TLS behavior. After deliberately repairing stale web dependencies, CI waits for that health condition before issuing its external curl, preventing a Vite restart race. It uses a distinct host port to avoid collisions.

## Risks / Trade-offs

- [A developer must install and trust `mkcert`] → This is explicitly documented and preserves secure-cookie behavior rather than adding an insecure HTTP fallback.
- [Source mounts may miss host filesystem events] → Compose-only polling is enabled for Vite; API `tsx watch` remains the existing watcher.
- [Compose startup builds the development image] → The `app` profile is opt-in, and named dependency volumes avoid repeated host/container dependency conflicts. A Node-and-lockfile fingerprint refreshes stale dependency volumes without removing PostgreSQL data.
- [A stale or failed database migration can block startup] → The failure is visible in the `migrate` service logs, and the recovery command reruns the idempotent migration service.

## Migration Plan

1. Generate the existing `mkcert` localhost certificate and copy `.env.example` to `.env`.
2. Run `docker compose --profile app up --build`.
3. If startup fails during migration, repair the issue and run `docker compose --profile app run --rm migrate`, then start the profile again.
4. Roll back by stopping the profile; database state remains in the existing named volume and direct development remains available.
