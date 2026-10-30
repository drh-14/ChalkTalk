## MODIFIED Requirements

### Requirement: Durable midnight dispatch and recovery

The system SHALL start dispatch of eligible previous-day digests at or after 00:00 UTC. It SHALL recover eligible dates missed since deployment and retry failed provider sends using durable unique intents and expiring claims. Before the first network send it SHALL persist the exact composed digest including sender, recipient, HTML, plain text, and inline CID image bytes. Every retry SHALL reuse that payload and a stable idempotency key, while rechecking the recipient address, active membership, course digest preference, course status, and current visibility and body of every included item. If any included item becomes inaccessible or substantively changes, the whole frozen digest SHALL be canceled. It SHALL record success only after provider acceptance and SHALL clear the snapshot after success or cancellation. It SHALL not claim exactly-once delivery beyond the provider's idempotency window.

#### Scenario: API process restart
- **WHEN** the API process was unavailable at midnight and restarts later
- **THEN** it discovers eligible missed dates and attempts their per-course digests without creating duplicate intents

#### Scenario: SMTP failure
- **WHEN** SMTP rejects a digest attempt in local development, or Resend rejects or ambiguously accepts a production digest attempt
- **THEN** the intent remains retryable with its identical snapshot and key

#### Scenario: Access revoked before send
- **WHEN** the recipient leaves, changes address, opts out, the course is archived, or any snapshotted item becomes inaccessible or substantively changes
- **THEN** the whole pending digest is canceled and no provider call occurs
