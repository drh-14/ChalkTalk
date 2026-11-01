## MODIFIED Requirements

### Requirement: Durable midnight dispatch and recovery

The system SHALL start dispatch of eligible previous-day digests at or after 00:00 UTC. It SHALL recover eligible dates missed since deployment and retry failed provider sends using durable unique intents and expiring claims. Before the first network send it SHALL persist the exact composed digest including sender, recipient, HTML, plain text, and inline CID image bytes and exact RFC 2822 MIME bytes. Every retry SHALL use the original provider and reuse that payload and its MIME bytes, while rechecking the recipient address, active membership, course digest preference, course status and name, current visibility, title, and body of every included item, and every linked or embedded image represented in the message. If the course name changes, any included item becomes inaccessible or its title or body changes, or a represented image is deleted, the whole frozen digest SHALL be canceled. A sender-address or selected-provider change SHALL also cancel and scrub the frozen digest before any provider call. It SHALL record success only after provider acceptance and SHALL clear the snapshot after success or cancellation. Gmail offers no idempotency key, so an ambiguous accepted send may be delivered twice on retry.

#### Scenario: API process restart

- **WHEN** the API process was unavailable at midnight and restarts later
- **THEN** it discovers eligible missed dates and attempts their per-course digests without creating duplicate intents

#### Scenario: Provider failure

- **WHEN** SMTP rejects a digest attempt in local development, or Gmail rejects or ambiguously accepts a production digest attempt
- **THEN** the intent remains retryable with its identical snapshot and MIME bytes

#### Scenario: Access revoked before send

- **WHEN** the recipient leaves, changes address, opts out, the course is archived, or any snapshotted item becomes inaccessible or substantively changes
- **THEN** the whole pending digest is canceled and no provider call occurs
