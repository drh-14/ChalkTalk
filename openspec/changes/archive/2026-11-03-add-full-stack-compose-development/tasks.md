## 1. Specification

- [x] 1.1 Add and strictly validate this Compose-development proposal, design, task list, and core-foundation delta.

## 2. Development workflow

- [x] 2.1 Write failing focused tests for Vite's default and configured API proxy targets and TLS settings, then implement the minimal configurable configuration.
- [x] 2.2 Add the Node 22 development image, ignore rules, and opt-in Compose `app` services with source mounts, self-reconciling named dependency volumes, health gating, migration gating, private API exposure, and HTTPS web entry point.
- [x] 2.3 Document dependency-only and full-stack workflows, certificate bootstrap, and migration recovery.

## 3. Continuous integration and validation

- [x] 3.1 Add a separate Compose CI smoke job that validates configuration, starts the full profile, verifies proxied HTTPS health and migrations, proves stale application dependencies self-repair, and always collects logs/cleans up.
- [x] 3.2 Run focused tests before and after the implementation, workspace checks, OpenSpec strict validation, and both local Compose workflows; record results and unavailable evidence.

## Validation evidence

- 2026-09-26: Before implementation, `npx vitest run apps/web/development-config.test.ts` failed with two expected failures because `createViteConfig` did not yet exist. The focused configuration tests then passed after each implementation slice.
- 2026-09-26: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and `openspec validate add-full-stack-compose-development --strict` passed. `TEST_DATABASE_URL=postgresql://chalktalk:chalktalk@localhost:5432/chalktalk npm test` passed all 40 tests, including 21 PostgreSQL integration tests.
- 2026-09-26: `docker compose up -d` started only healthy PostgreSQL and Mailpit. With a temporary smoke-test certificate and `.env.example`, `docker compose --profile app up --build --wait --wait-timeout 180` succeeded. `https://localhost:5174/api/health` returned `{ "status": "ok" }`, and `schema_migrations` contained two recorded migrations. The temporary full-stack services and certificate were removed; the dependency-only services were restored and healthy.
- 2026-09-26: The Node-only Vite configuration test passed after its per-file environment directive. `TEST_DATABASE_URL=postgresql://chalktalk:chalktalk@localhost:5432/chalktalk npm test` passed all 53 tests, including 21 PostgreSQL integration tests; formatting, linting, type checking, builds, strict OpenSpec validation, and the whitespace check passed.
- 2026-09-26: Rebuilt the live `app` profile, deliberately removed `jsdom` and replaced the web dependency-volume fingerprint with `stale`, then restarted only the web service. Its entrypoint ran `npm ci`, restored `jsdom`, served proxied HTTPS health successfully, and left the PostgreSQL migration ledger at two rows.
- 2026-09-26: Corrected the ignore-rule precedence so the safe `.env.example` template is tracked while local `.env`, other `.env*` files, and `.cert/` remain ignored. The Compose CI setup now verifies those tracking rules before copying the template into its ephemeral `.env`.
- 2026-09-26: The stale-dependency CI restart exposed a Vite readiness race: its immediate external HTTPS curl could receive `connection reset by peer` while `npm ci` refreshed the dependency volume and Vite rebound its listener. Added a web health check that waits for its internal HTTPS `/api/health` proxy (with TLS verification disabled only inside that CI-compatible probe), then made CI wait for the restarted web service to become healthy before curling it externally.
- 2026-09-26: `docker compose --profile app config --quiet` passed. Rebuilt the profile with `up --build --wait`; PostgreSQL, API, and web became healthy, the HTTPS proxy returned `{\"status\":\"ok\"}`, and the migration ledger contained two rows. Removed `jsdom`, wrote a stale dependency fingerprint, restarted web, then ran `docker compose --profile app up --wait --wait-timeout 120 --no-deps web`; it waited for healthy status before the external HTTPS curl, restored `jsdom`, replaced the stale fingerprint, and retained the two migration rows.
