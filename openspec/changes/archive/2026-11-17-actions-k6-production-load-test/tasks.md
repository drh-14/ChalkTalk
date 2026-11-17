## 1. Specification and tests
- [x] 1.1 Validate this OpenSpec amendment and resolve any design conflicts before code
- [x] 1.2 Add failing tests for profile validation/fingerprint, target identity, VM claim lifecycle, coverage, report sanitization, workflow and dashboard provisioning

## 2. Implementation
- [x] 2.1 Implement validated bounded profile and selected-operation coverage in k6
- [x] 2.2 Implement VM-owned atomic claim/verification and reviewed fixture orchestration
- [x] 2.3 Implement pinned-SSH Actions smoke/ramp workflow, secret-safe target comparison, private tunnel, sanitization and finalizers
- [x] 2.4 Move Grafana dashboard to `Load Tests` and update runbook/disclosures

## 3. Verification and delivery
- [x] 3.1 Run focused tests, strict OpenSpec validation, build/typecheck/lint/format and isolated real-stack rehearsal with browser screenshots and cleanup/failure cases
- [x] 3.2 Archive OpenSpec after local verification; PR delivery and final-head CI are tracked in the handoff
