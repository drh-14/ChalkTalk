## 1. Safety contract

- [x] 1.1 Add red fixture tests for three-course provisioning, manifest validation, dependency caps, foreign references, and zero-residue cleanup; verify expected failures
- [x] 1.2 Implement mode-aware fixture and reviewed Thread/resource teardown; verify fixture tests and isolated PostgreSQL lifecycle

## 2. Traffic and coverage

- [x] 2.1 Add red profile/workload tests for 10–30 VUs, three cohorts, write caps and delayed-VU global pacing; verify expected failures
- [x] 2.2 Implement role-aware journeys, bounded Thread REST/socket and resource reads, and required coverage; verify focused k6 integration tests

## 3. Reports and delivery

- [x] 3.1 Add red report/sanitizer tests for single-unit panels, bounded run-scoped queries, nested ID screening, and missing series; verify expected failures
- [x] 3.2 Implement renderer, sanitizer, cleanup receipt and screened four-attachment Resend delivery; verify report and delivery tests including failure statuses

## 4. Orchestration and handoff

- [x] 4.1 Wire workflow/runner/runbook with separate result statuses and no production dispatch; verify workflow and shell tests
- [x] 4.2 Run focused/full checks, isolated real-stack rehearsal with zero residue, strict OpenSpec validation, and archive the change
Delivery after implementation/archive: run no-mistakes, squash to one commit, publish draft PR, and verify final-head CI and commit count
