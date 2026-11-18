## 1. Specify and test

- [x] 1.1 Strict-validate proposal, delta spec, design, and tasks before behavior code
- [x] 1.2 Write focused failing workflow/profile/state tests for one-input Ramp, independent singleton claim, manifest provenance, and self-cleaning Smoke
- [x] 1.3 Write focused failing workload/cleanup tests for reader/writer separation, deterministic coverage, bounded connection-limit retry, and unsafe outcomes

## 2. Implement bounded independent lifecycle

- [x] 2.1 Implement one-input workflow and code-owned normalized profiles without TPS or old Environment load controls
- [x] 2.2 Implement fresh VM Ramp claim and manifest identity recording while preserving legacy cleanup compatibility
- [x] 2.3 Implement self-contained provision/traffic/telemetry/cleanup for Ramp and self-cleaning Smoke, with bounded recognized connection-acquisition retry
- [x] 2.4 Implement read-heavy session-like readers and dedicated bounded writer; update checked coverage and sanitized report provenance
- [x] 2.5 Update operator runbook and remove obsolete Smoke-to-Ramp instructions

## 3. Verify and deliver

- [x] 3.1 Run focused suites, full relevant tests, lint, format, typecheck, build, and strict OpenSpec validation
- [x] 3.2 Rehearse isolated real API/PostgreSQL/k6/Prometheus/Grafana flows and verify zero local fixture residue; do not dispatch production
- [x] 3.3 Archive OpenSpec after local verification
