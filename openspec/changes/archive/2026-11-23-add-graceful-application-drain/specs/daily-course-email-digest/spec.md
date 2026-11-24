## ADDED Requirements

### Requirement: Process drain settles owned digest effects

Worker drain SHALL stop new digest schedule and delivery admissions synchronously, track already-started schedule/claim/delivery operations before asynchronous work and await their database, composition/render-worker, image-storage, provider and ownership-checked outbox settlement. A claim arriving after cutoff SHALL remain owned. A known durable retry/cancel outcome MAY settle; ambiguous provider acceptance, accepted send with unconfirmed final commit, lost ownership or zero-row fenced settlement SHALL fail application drain even when a retry row exists. Shutdown SHALL NOT clear claims merely to report cleanliness or claim exactly-once delivery.

#### Scenario: Accepted send followed by uncertain commit

- **WHEN** a fake provider accepts a digest and the final outcome transaction fails or has unknown commit status
- **THEN** drain fails and replacement is blocked, rather than claiming the durable retry proves a clean send outcome

#### Scenario: Schedule or claim overlaps cutoff

- **WHEN** scheduling or a delivery claim begins before cutoff and completes afterward
- **THEN** its transaction and acquired attempt are awaited and no new scheduling or delivery iteration starts

#### Scenario: Known retry outcome

- **WHEN** a provider definitively rejects a send and the matching owned attempt commits its documented retry state
- **THEN** the attempt can settle normally without sending real email or emptying the pending outbox
