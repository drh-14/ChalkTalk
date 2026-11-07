# outbound-email-transport Specification

## Purpose

Deliver ChalkTalk application email through an explicitly selected provider while preserving recipient eligibility, privacy, and safe durable retries.

## Requirements

### Requirement: Explicit provider selection

Normal local and production deployment SHALL use Resend HTTPS, with an API key required at startup and the verified-domain sender fixed in application constants. A legacy `EMAIL_FROM` environment value SHALL NOT override that sender. Neither Compose stack SHALL run Mailpit or send through SMTP. The local test environment MAY use an HTTP or HTTPS mock Resend origin. Production SHALL reject SMTP selection and SHALL NOT fall back to another provider. Existing mail triggers, recipients, and content SHALL be unchanged.
Production SHALL reject a `RESEND_API_BASE_URL` override unless it is the official `https://api.resend.com` origin.

#### Scenario: Local development

- **WHEN** the local Compose application starts with a Resend key
- **THEN** authentication and queued emails use Resend HTTPS

#### Scenario: Missing production credentials

- **WHEN** the local application starts without a Resend key
- **THEN** startup fails clearly

#### Scenario: Production delivery

- **WHEN** the production application starts with valid Resend configuration
- **THEN** authentication and queued emails use Resend HTTPS

#### Scenario: Production SMTP override

- **WHEN** a production process sets `EMAIL_PROVIDER=smtp`
- **THEN** startup fails rather than sending through SMTP

#### Scenario: Production Resend origin override

- **WHEN** a production process sets `RESEND_API_BASE_URL` to any other origin
- **THEN** startup fails rather than sending to that origin

#### Scenario: Local operator authorization

- **WHEN** an operator configures Resend delivery
- **THEN** only the API key is required; the verified sender is fixed in code; no extra credential bootstrap is performed

#### Scenario: Configurable local Resend endpoint

- **WHEN** Resend is configured with a valid alternate API origin for testing
- **THEN** the client sends to that origin

#### Scenario: Legacy sender environment setting

- **WHEN** Resend is selected with a valid API key and a legacy `EMAIL_FROM` setting
- **THEN** the application still uses the fixed verified-domain address

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
