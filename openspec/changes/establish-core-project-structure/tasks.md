## 1. OpenSpec artifacts

- [x] 1.1 Define the foundation capability and its observable requirements; verify with `openspec validate establish-core-project-structure --strict`.
- [x] 1.2 Document the workspace, database, and local-runtime design; verify the design has no unresolved implementation questions.

## 2. Workspace and local services

- [x] 2.1 Create the root npm workspace, shared TypeScript and quality-tool configuration; verify install, lint, typecheck, test, and build commands are available from the root.
- [x] 2.2 Add the React and Vite web shell with development API forwarding; verify the production web build succeeds.
- [ ] 2.3 Add Docker Compose PostgreSQL, example environment configuration, and root setup instructions; verify Compose configuration is valid.

## 3. API and migrations

- [x] 3.1 Write a failing HTTP-level health-endpoint test, then implement the composable Express API and `GET /health`; verify the test passes with HTTP 200 and `{ "status": "ok" }`.
- [ ] 3.2 Write a failing integration test for ordered, idempotent SQL migrations, then implement the PostgreSQL connection and migration runner; verify it passes against local PostgreSQL when available.
- [ ] 3.3 Add the initial migration ledger migration; verify running migrations twice records it once.

## 4. Validation

- [x] 4.1 Run formatting, linting, type checking, tests, and production builds; verify every applicable command succeeds.
- [x] 4.2 Start the local stack and request the proxied health endpoint; verify the browser development server returns the API health response.

## Validation evidence

- 2026-09-25: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` passed locally. `openspec validate establish-core-project-structure --strict` passed.
- PostgreSQL integration execution and Docker Compose validation cannot run in this environment because neither `TEST_DATABASE_URL` nor Docker is available. CI provisions PostgreSQL and its successful verification run is https://github.com/drh-14/ChalkTalk/actions/runs/36210344713.
