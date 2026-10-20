# Tasks

## 1. Idle ending

- [x] 1.1 Add migration `022_collaboration_last_active.sql` and document the column in `database.md`; verify a schema test for the default and backfill
- [x] 1.2 Maintain `last_active_at` and end idle sessions in the sweep (design D1, D2), with `COLLABORATION_IDLE_END_MINUTES`; verify collaboration server tests that an idle session ends and leaves active lists, a connected but silent session does not end, and the idle period survives a restart; document idle ending in `collaboration-websocket.md` and `collaboration-sessions.md`

## 2. Rate limits

- [x] 2.1 Add `consumeRateLimit` and the two limits (design D3) with their environment variables and `.env.example`; verify HTTP tests for `429 rate_limited`, `Retry-After`, no session or ticket created when limited, and idempotent replays not counted
- [x] 2.2 Document the 429 responses in `collaboration-sessions.md` and `openapi.yaml`; verify the YAML parses; verify a component test that the start form shows the rate-limit message

## 3. Metrics

- [x] 3.1 Add the collaboration metrics and `/metrics` route (design D4); verify server tests for `401` without the token, `200` with it, each series present, and no identifiers in the output
- [x] 3.2 Add the Prometheus target, the Grafana row, and the smoke-script check; verify the dashboard test still passes and `docker compose config` accepts the change

## 4. Checks

- [x] 4.1 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
  - Local run on Windows, 2026-10-20: format, lint, typecheck, and the dashboard PromQL test pass; collaboration, config, and worker suites pass when run alone. Failures in the loaded full API run are the same environment-only tests as on `main` (`validate.test.ts`, `openapi.contract.test.ts`, the two process-separation tests) plus 5-second timeouts. The compose observability smoke run is left to CI.
- [ ] 4.2 Archive after `add-live-code-sessions`, `add-session-whiteboard`, and `add-session-invitations` are archived
