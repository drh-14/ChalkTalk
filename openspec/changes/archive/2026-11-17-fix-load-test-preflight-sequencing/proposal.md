## Why

Two production smoke attempts stopped before k6 traffic and consumed their unique fixture IDs: one began too soon after Prometheus restarted, and the other required HTTP latency samples from an otherwise healthy but idle API. Preflight should test telemetry that can exist before traffic, without weakening the post-smoke evidence gate.

## What Changes

- Wait for two fresh successful API, worker, collaboration, and VM scrape samples before claiming a smoke or ramp attempt or provisioning a fixture
- Fail without consuming a run ID if the bounded wait expires, with a diagnostic naming the failing target
- Defer HTTP and database-client latency sample checks until after smoke traffic, alongside existing k6 and VM checks
- Replace the combined manual workflow with separately named Smoke and Ramp dispatches that have no run-ID input: Smoke derives an ID from its trusted Actions run identity, while Ramp atomically selects the sole eligible verified smoke fixture on the VM
- Fail closed if any active or uncertain fixture conflicts, or if ramp has no single recent matching fixture; do not silently retry an Actions run attempt

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `bounded-load-testing`: Separate pre-traffic scrape readiness from post-traffic load observability

## Impact

The Actions workflows, runner, VM attempt ledger, telemetry verifier, and runbook change; fixture data shape, workload, metrics collection, dashboard, and production target remain unchanged. No new dependency or database migration is required.
