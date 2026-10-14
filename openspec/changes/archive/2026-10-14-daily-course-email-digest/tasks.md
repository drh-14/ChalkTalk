## 1. Contract and persistence

- [x] 1.1 Write failing PostgreSQL-backed profile and digest tests from the spec; verify they fail for missing behavior.
- [x] 1.2 Add the opt-in and unique leased outbox migration; verify migration and database constraint tests pass.
- [x] 1.3 Add authenticated version-checked profile preference and opt-out cancellation; verify profile HTTP tests pass.

## 2. Generation and delivery

- [x] 2.1 Select eligible prior-day activity and queue separate course emails; verify filtering, date boundaries, deduplication, and catch-up tests pass.
- [x] 2.2 Claim, recheck, send, retry, and recover outbox records; verify SMTP failure, opt-out, archive, membership, and lease tests pass.
- [x] 2.3 Start scheduler on API startup and verify midnight eligibility and restart behavior.

## 3. Documentation and verification

- [x] 3.1 Update auth/API/OpenAPI/database docs and verify OpenAPI contract tests pass.
- [x] 3.2 Run focused and full checks plus a Mailpit smoke test; verify an actual captured course email and no email for empty/opted-out cases.
- [x] 3.3 Archive this OpenSpec change after all tasks and checks pass; verify archive is present.
