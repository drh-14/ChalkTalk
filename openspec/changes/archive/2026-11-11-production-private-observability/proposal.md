## Why

The deployed VM has bounded container logs but no searchable production logs or metrics dashboard. Operators need a private way to diagnose failures without exposing telemetry or application data on the public web.

## What Changes

- Enable protected API, worker, and collaboration metrics in production using the existing metrics token.
- Run Prometheus, Loki, Alloy, and Grafana in the production Compose stack; collect only the existing sanitized API and worker log spools.
- Bind Grafana to VM loopback for SSH forwarding, with no public Caddy route or new firewall port.
- Retain logs for seven days and metrics for fifteen days; persist collector state and dashboard data.

## Capabilities

### Modified Capabilities

- `api-observability`: Replace the production-off rule with private, token-protected monitoring and a production operator dashboard.
- `single-vm-deployment`: Permit Grafana's loopback-only port while keeping only Caddy publicly exposed.

## Impact

API configuration, production Dockerfiles and Compose, shared observability configuration, deployment preflight and docs, observability tests, and the production release workflow. The separately staged bootstrap secrets must be rendered on the VM before this release deploys.
