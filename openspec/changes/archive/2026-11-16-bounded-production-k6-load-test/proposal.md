## Why

The production deployment now exposes application and VM metrics, but ChalkTalk has no reproducible way to measure those signals under bounded concurrent user traffic. The first test must be isolated from real user data and safe for a small production service.

## What Changes

- Add a manually invoked backend-only k6 workload with a hard 20-VU, approximately ten-minute ceiling and bounded writes in a synthetic course
- Add privileged, fail-closed synthetic fixture provisioning and teardown with target confirmation and an owner-only credential manifest
- Accept k6 remote-write through a VM-loopback-only Prometheus listener and provision a dedicated correlation dashboard
- Add a preflight and runbook covering fresh metric evidence, a one-VU smoke, monitoring and abort conditions, and reviewed cleanup

## Capabilities

### New Capabilities

- `bounded-load-testing`: Safety, workload, fixture, telemetry, and evidence requirements for a manually operated production load test

### Modified Capabilities

None. Public API behavior and schema do not change.

## Impact

Deployment Compose and Grafana provisioning; a privileged CLI and k6 scripts; tests and operator documentation. Prometheus receives low-volume k6 samples on loopback; no public endpoint, permanent bypass, new production schema, or Supabase Metrics API scrape is added.
