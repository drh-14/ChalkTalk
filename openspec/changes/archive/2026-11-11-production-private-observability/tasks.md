## 1. Production telemetry contract

- [x] 1.1 Write failing environment and metrics tests for required production token/spool settings and protected scrapes; verify focused tests fail for the expected reason.
- [x] 1.2 Enable production telemetry while retaining local behavior; verify focused tests pass.

## 2. Shared and production stack

- [x] 2.1 Move local observability configuration to `deployment/observability/` and update local Compose paths; verify local Compose config and observability contract tests.
- [x] 2.2 Add production Grafana, Prometheus, Loki, and Alloy services, persistent volumes, private port binding, and writable API/worker spool mounts; verify Compose config and container write/tail smoke.
- [x] 2.3 Add Docker Engine 28+ preflight before production Compose start; verify old-version rejection and current-version acceptance in release-script tests.
- [x] 2.4 Add production stack privacy tests for protected metrics, sanitized log ingestion/recovery, internal-only service ports, and dashboard provisioning; verify with container integration and a real browser screenshot.

## 3. Documentation and delivery

- [x] 3.1 Update production deployment and API observability docs, env template, and SSH forwarding instructions; verify links/formatting.
- [x] 3.2 Run focused tests, Compose smoke, and lint/format checks.
