## 1. Contract and tests

- [x] 1.1 Add tests for metrics authorization, route cardinality, request abort/errors, job outcomes, and private payload exclusion; verify the core new behavior is RED before implementation and all cases GREEN afterward.
- [x] 1.2 Add failing tests for spool rotation, cap eviction, disk failure, and restart replay; verify expected RED with Vitest.

## 2. API implementation

- [x] 2.1 Add environment validation and Prometheus request/job instrumentation; verify focused tests and typecheck.
- [x] 2.2 Add safe structured JSON logger and bounded asynchronous spool; verify privacy and outage tests.
- [x] 2.3 Wire request/error and worker events while preserving API behavior; verify contract and integration tests.

## 3. Local monitoring stack

- [x] 3.1 Add opt-in Compose profile and pinned Prometheus/Grafana/Logstash/Elasticsearch configuration; verify Compose config and real service startup.
- [x] 3.2 Provision metric/log dashboards and retention; verify scrape, indexed logs, seven/fifteen-day settings, and real-browser screenshots.
- [x] 3.3 Add outage/backlog/restart/privacy smoke and CI coverage; verify real Compose scenario.

## 4. Delivery

- [x] 4.1 Update API/operations documentation and OpenAPI; verify spec and documentation checks.
- [x] 4.2 Run full tests, typecheck, lint, build, and archive OpenSpec; verify commands pass.
- [x] 4.3 Run no-mistakes, address findings, squash to one commit, and publish a draft PR; verify final-head CI and PR state.
