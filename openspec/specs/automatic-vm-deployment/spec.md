# automatic-vm-deployment Specification

## Purpose
Define the trust, serialization, and verification requirements for automatic production releases from successful current-main CI runs.

## Requirements

### Requirement: Successful current main only
The deployment workflow SHALL accept only a successful `push` CI run from this repository's `main` whose SHA is still the current remote `main`. It SHALL recheck before production mutation and never expose production secrets to untrusted CI runs.

#### Scenario: Stale or untrusted CI
Given a failed, forked, non-push, or no-longer-current CI run, when the workflow completes, then no production mutation or secret-using step runs.

### Requirement: Serialized exact release
The VM SHALL serialize release changes with bootstrap and other deploys, check out the exact tested SHA detached, use the shared production env for Compose interpolation and containers, build before starting, and stop on migration or health failure without automatic database rollback.

#### Scenario: Build or migration failure
Given a failed build or migration, when deployment stops, then it leaves the previous checkout and database intact and does not mark the new SHA successful.

### Requirement: Smoke before success
For each new successful SHA, deployment SHALL verify the migration ledger, private Storage write/read/delete with cleanup, one Resend-accepted synthetic email to `chalktalk602@gmail.com`, and external HTTPS web/API. It SHALL mark success only after those checks; repeat of an already successful SHA SHALL not resend the synthetic email.

#### Scenario: Successful deployment and repeat
Given a current, tested main SHA, when all checks pass, then it becomes the successful SHA and a repeated run skips provider smoke.
