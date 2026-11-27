## ADDED Requirements

### Requirement: Bounded host serialization and independent deployment holds

Deployment stage and finish SHALL wait at most 600 seconds for the existing host deployment flock and fail without release mutation on timeout. New stage work SHALL respect a persistent root-controlled deployment hold both before mutation and after waiting for the lock. This hold SHALL be distinct from the automatic-update hold and SHALL NOT prevent an already-staged release from completing finish bookkeeping. Release trust, exact-SHA checks, provider smoke, external checks and success markers SHALL retain their existing behavior. Deployment SHALL NOT clear holds, interrupt package transactions or infer zero downtime from maintenance coordination.

#### Scenario: Automatic maintenance holds the host lock

- **WHEN** a deployment stage or finish cannot obtain the lock within 600 seconds
- **THEN** it fails without changing releases, pending/deployed markers or Compose state and does not interrupt maintenance

#### Scenario: Deployment hold is placed while stage waits

- **WHEN** stage acquires the host lock after a root-created deployment hold has been established
- **THEN** it refuses new stage mutations without clearing the hold

#### Scenario: Deployment hold does not freeze updates or finalization

- **WHEN** a deployment hold is present but no update hold exists
- **THEN** otherwise eligible automatic maintenance can run and an already-staged SHA can finish its existing checks/bookkeeping

#### Scenario: Update-only hold during deployment

- **WHEN** only an update hold is present and all existing deployment trust/health requirements pass
- **THEN** deployment proceeds without removing the update hold
