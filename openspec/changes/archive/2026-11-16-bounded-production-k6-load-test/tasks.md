## 1. Safety and contracts

- [x] Add tests first for target/run validation, atomic provisioning, manifest mode, inventory, and fail-closed cleanup against isolated PostgreSQL
- [x] Implement privileged fixture CLI and owner-only manifest without public endpoints or mail

## 2. Bounded workload

- [x] Add tests first for workload ceilings, fixed tags, auth/CSRF/origin, read/write mix, and unexpected status handling
- [x] Implement external k6 smoke and ramp scripts with bounded isolated writes and local report outputs

## 3. Correlation

- [x] Add Compose and dashboard/PromQL assertions first
- [x] Enable loopback-only remote-write and provision the dedicated dashboard
- [x] Add preflight for fresh API, DB-client, VM and k6 series

## 4. Verification and delivery

- [x] Validate OpenSpec, focused tests, full build/typecheck/lint/format, Compose, disposable remote-write and Grafana browser smoke with screenshots
- [x] Document manual production gates and cleanup; do not run production ramp
