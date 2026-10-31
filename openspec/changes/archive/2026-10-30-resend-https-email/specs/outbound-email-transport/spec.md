## Purpose

Deliver ChalkTalk's existing application emails through an explicitly selected provider while preserving recipient eligibility, privacy, and safe durable retries.

## ADDED Requirements

### Requirement: Explicit provider selection

The system SHALL support SMTP for local Mailpit and Resend HTTPS for production, without automatic fallback between providers. Resend mode SHALL require an API key and sender address at startup. Selecting a provider SHALL NOT change email triggers, recipients, or content.

#### Scenario: Local development
- **WHEN** SMTP mode is selected with Mailpit configured
- **THEN** existing authentication and queued email is delivered through SMTP without Resend credentials

#### Scenario: Missing production credentials
- **WHEN** Resend mode is selected without a usable API key or sender address
- **THEN** application startup fails clearly without attempting SMTP

### Requirement: Durable identical queued retries

The system SHALL persist each queued outbound message, including sender, recipient, text, HTML, and inline attachments, before its first network send. A retry SHALL use the identical message and stable provider idempotency key. A confirmed success or cancellation SHALL erase the snapshot. An accepted provider response SHALL be required before recording delivery success.

#### Scenario: Ambiguous network drop
- **WHEN** a network connection drops after Resend may have accepted a queued message
- **THEN** a retry uses exactly the same payload and key, without switching to SMTP

#### Scenario: Worker interruption
- **WHEN** a worker stops after snapshot commit but before acknowledgment
- **THEN** a reclaimed attempt uses the persisted snapshot and key

#### Scenario: Provider failure
- **WHEN** Resend times out, returns a retryable failure, or returns malformed success
- **THEN** the message remains retryable and is not recorded as delivered

### Requirement: Revalidate before each attempt

The system SHALL recheck current recipient address, preferences, membership, course and referenced-content lifecycle, and current visibility before every queued send. It SHALL cancel rather than send if eligibility is lost, if an included response or announcement body substantively changes, or if the recipient address changes. Title-only edits MAY leave frozen wording unchanged. Invalidation SHALL result in zero provider calls on that attempt.

#### Scenario: Changed address or body
- **WHEN** the recipient email address or referenced message body changes after the queued payload is frozen
- **THEN** the pending email is canceled and no provider call occurs

#### Scenario: Access revoked
- **WHEN** a recipient leaves, opts out, unfollows where applicable, or loses access to referenced content
- **THEN** the pending email is canceled without exposing the frozen content

#### Scenario: Authentication mail
- **WHEN** an immediate verification or reset email is requested
- **THEN** it uses the selected provider and retains its existing timeout and failure behavior without being added to the durable queue
