## 1. Contract and persistence

- [x] 1.1 Write failing PostgreSQL-backed digest tests from the spec; verify they fail for missing behavior.
- [x] 1.2 Add the unique leased outbox migration with a deployment-day UTC cursor; verify migration and database constraint tests pass.
- [x] 1.3 Verify profile responses contain no digest preference and that a preference update is rejected.

## 2. Generation and delivery

- [x] 2.1 Select eligible prior-day activity for every active course member and queue separate course emails; verify filtering, date boundaries, deduplication, deployment cutover, and catch-up tests pass.
- [x] 2.2 Claim, recheck, send, retry, and recover outbox records; verify SMTP failure, archive, membership, content visibility, and lease tests pass.
- [x] 2.3 Start scheduler on API startup and verify midnight eligibility and restart behavior.

## 3. Documentation and verification

- [x] 3.1 Update API/database/OpenSpec docs and verify OpenAPI contract tests pass without a digest profile field.
- [x] 3.2 Run focused and full checks plus a Mailpit smoke test; verify an actual captured course email and no email for empty course-days.
- [x] 3.3 Keep this completed change archived and verify the archive and main spec match.
