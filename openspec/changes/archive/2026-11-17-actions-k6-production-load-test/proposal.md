## Why

The draft k6 change still requires an operator laptop, manual manifest transfer, and a local-only rerun guard. The approved amendment moves bounded execution to manually dispatched GitHub Actions while retaining a human smoke-to-ramp gate and VM-owned safety state.

## What Changes

- Replace the laptop runner with separate, production-environment `workflow_dispatch` smoke and ramp operations from trusted `main`.
- Validate the three required Environment profile variables, current deployed SHA, Supabase project identity, and deployed database URL before fixture access.
- Keep attempt state and credentials private on the VM; use atomic claims and fail-closed cleanup/recovery.
- Require successful selected-operation coverage, sanitized downloadable reports, and a correlated Grafana dashboard in a `Load Tests` folder.
- State explicitly that the HTTP workload covers selected core flows, not every application feature.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bounded-load-testing`: revise the runner, profile, lifecycle, coverage, and telemetry evidence contracts.

## Impact

GitHub Actions, k6 workload and operator scripts, VM fixture operations, Grafana provisioning, documentation and tests. No public API endpoint or production database schema change. No load is triggered by ordinary CI or deploy.
