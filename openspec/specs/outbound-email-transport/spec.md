# outbound-email-transport Specification

## Purpose

Deliver ChalkTalk application email through an explicitly selected provider while preserving recipient eligibility, privacy, and safe durable retries.

## Requirements

### Requirement: Explicit provider selection

The system SHALL support SMTP for local Mailpit and Resend HTTPS when explicitly selected, without automatic fallback between providers. Resend mode SHALL require an API key and sender address at startup. Its API base URL SHALL default to the Resend HTTPS origin and MAY be configured as an HTTP or HTTPS origin for local integration testing. Selecting a provider SHALL NOT change email triggers, recipients, or content.

#### Scenario: Local development

- **WHEN** SMTP mode is selected with Mailpit configured
- **THEN** existing authentication and queued email is delivered through SMTP without Resend credentials

#### Scenario: Missing production credentials

- **WHEN** Resend mode is selected without usable API key or sender address
- **THEN** application startup fails clearly without attempting SMTP

#### Scenario: Local operator authorization

- **WHEN** an operator configures Resend delivery
- **THEN** only the API key and verified sender are required; no extra credential bootstrap is performed

#### Scenario: Configurable local Resend endpoint

- **WHEN** Resend mode is selected with a valid alternate API origin
- **THEN** the Resend client sends to that origin with the configured API key and sender
- **WHEN** the alternate API origin is malformed or contains credentials, a path, query, or fragment,
- **THEN** application startup fails clearly

### Requirement: Durable identical queued retries

The system SHALL persist each queued outbound message, including sender, recipient, text, HTML, inline attachments, and a frozen provider payload, before its first network send. The frozen snapshot SHALL bind the selected provider. A retry SHALL use the identical provider payload and stable Resend idempotency key only while that provider remains selected; a provider switch SHALL cancel and erase the snapshot without a send. Resend idempotency is limited to its documented window, so duplicates MAY occur after expiry. A confirmed success or cancellation SHALL erase the snapshot. An accepted provider response SHALL be required before recording delivery success. Invalidated email jobs SHALL terminate durably as canceled, clear their snapshot and claim, and record a non-sensitive reason rather than success.

#### Scenario: Ambiguous network drop

- **WHEN** a network connection drops after Resend may have accepted a queued message
- **THEN** a retry uses exactly the same provider payload and idempotency key, without switching to SMTP

#### Scenario: Provider switch after an ambiguous attempt

- **WHEN** a frozen Resend or SMTP email is retried with a different selected provider
- **THEN** it is canceled and scrubbed without calling either provider

#### Scenario: Worker interruption

- **WHEN** a worker stops after snapshot commit but before acknowledgment
- **THEN** a reclaimed attempt uses the persisted snapshot and identical payload and key

#### Scenario: Provider failure

- **WHEN** Resend times out, returns a retryable failure, or returns malformed success
- **THEN** the message remains retryable and is not recorded as delivered

#### Scenario: Provider authorization needs repair

- **WHEN** provider credentials are rejected
- **THEN** queued email remains frozen for operator repair without falling back to SMTP

#### Scenario: Resend quota or rate limit

- **WHEN** Resend responds with HTTP 429 for a queued email
- **THEN** it remains frozen and scheduled for a later retry according to retry policy, without being recorded as delivered

### Requirement: Revalidate before each attempt

The system SHALL recheck current recipient address, preferences, membership, course and referenced-content lifecycle, and current visibility before every queued send. It SHALL cancel rather than send if eligibility is lost, if an included title or body changes, if an included actor or sender identity changes or is deleted, if a represented image is deleted, or if the recipient address changes. Included identities and recipient membership deletion SHALL be locked through provider handoff so a committed access or identity change cannot be followed by a stale send. Recipient membership locks SHALL be retained through provider handoff for digests, duplicate notices, invitations, and private-post notifications; an opt-out update to a locked membership MAY wait until the in-flight send finishes, with Resend's external request bounded to 30 seconds. An already-started email MAY finish before that opt-out commits. Follow changes receive a final check but MAY finish while a provider send is already in flight. Invalidation SHALL result in zero provider calls on that attempt.

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
