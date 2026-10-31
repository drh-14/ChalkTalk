# outbound-email-transport Specification

## Purpose

Deliver ChalkTalk's existing application emails through an explicitly selected provider while preserving recipient eligibility, privacy, and safe durable retries.

## Requirements

### Requirement: Explicit provider selection

The system SHALL support SMTP for local Mailpit and Resend HTTPS when explicitly selected, without automatic fallback between providers. Resend mode SHALL require an API key and sender address at startup. Its API base URL SHALL default to the Resend HTTPS origin and MAY be configured as an HTTP or HTTPS origin for local integration testing. Selecting a provider SHALL NOT change email triggers, recipients, or content.

#### Scenario: Local development

- **WHEN** SMTP mode is selected with Mailpit configured
- **THEN** existing authentication and queued email is delivered through SMTP without Resend credentials

#### Scenario: Missing production credentials

- **WHEN** Resend mode is selected without a usable API key or sender address
- **THEN** application startup fails clearly without attempting SMTP

#### Scenario: Configurable local Resend endpoint

- **WHEN** Resend mode is selected with a valid alternate API origin
- **THEN** the Resend client sends to that origin with the configured key and sender
- **WHEN** the alternate endpoint is malformed or contains credentials, a path, query, or fragment
- **THEN** application startup fails clearly

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

The system SHALL recheck current recipient address, preferences, membership, course and referenced-content lifecycle, and current visibility before every queued send. It SHALL cancel rather than send if eligibility is lost, if an included title or body changes, if an included actor or sender identity changes or is deleted, if a represented image is deleted, or if the recipient address changes. Included identities SHALL be locked through provider handoff so a committed identity change cannot be followed by a stale-name send. Invalidation SHALL result in zero provider calls on that attempt.

#### Scenario: Changed address or content

- **WHEN** the recipient email address or an included title or body changes after the queued payload is frozen
- **THEN** the pending email is canceled and no provider call occurs

#### Scenario: Access revoked

- **WHEN** a recipient leaves, opts out, unfollows where applicable, or loses access to referenced content
- **THEN** the pending email is canceled without exposing the frozen content

#### Scenario: Included identity or image changes

- **WHEN** an included actor or sender identity changes or is deleted, or a linked or embedded digest image is deleted after the payload is frozen
- **THEN** the pending email is canceled before a provider call

#### Scenario: Authentication mail

- **WHEN** an immediate verification or reset email is requested
- **THEN** it uses the selected provider and retains its existing timeout and failure behavior without being added to the durable queue
