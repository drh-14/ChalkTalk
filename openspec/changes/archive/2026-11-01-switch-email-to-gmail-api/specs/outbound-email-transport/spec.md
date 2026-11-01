## MODIFIED Requirements

### Requirement: Explicit provider selection

The system SHALL support SMTP for local Mailpit and Gmail API HTTPS when explicitly selected, without automatic fallback between providers. Gmail mode SHALL require an OAuth client ID, client secret, refresh token, and sender address at startup. Its API base URL SHALL default to the Gmail API HTTPS origin and MAY be configured as an HTTP or HTTPS origin for local integration testing. Selecting a provider SHALL NOT change email triggers, recipients, or content.

#### Scenario: Local development

- **WHEN** SMTP mode is selected with Mailpit configured
- **THEN** existing authentication and queued email is delivered through SMTP without Gmail credentials

#### Scenario: Missing production credentials

- **WHEN** Gmail mode is selected without usable OAuth credentials or sender address
- **THEN** application startup fails clearly without attempting SMTP

#### Scenario: Local operator authorization

- **WHEN** the operator runs the local bootstrap helper with a Desktop OAuth client
- **THEN** it requests only `gmail.send` with offline access and PKCE S256, verifies callback state, and saves the refresh token in an ignored owner-readable file without logging it or exposing a ChalkTalk route

#### Scenario: Configurable local Gmail endpoints

- **WHEN** Gmail mode is selected with valid alternate API and OAuth endpoints
- **THEN** the Gmail client sends to that origin with the configured OAuth credentials and sender
- **WHEN** the alternate endpoint is malformed or contains credentials, a path, query, or fragment
- **THEN** application startup fails clearly

### Requirement: Durable identical queued retries

The system SHALL persist each queued outbound message, including sender, recipient, text, HTML, inline attachments, and exact RFC 2822 MIME bytes, before its first network send. The frozen snapshot SHALL bind the selected provider. A retry SHALL use the identical MIME bytes only while that provider remains selected; a provider switch SHALL cancel and erase the snapshot without a send. Gmail has no idempotency key, so an ambiguous retry MAY duplicate delivery. A confirmed success or cancellation SHALL erase the snapshot. An accepted provider response SHALL be required before recording delivery success. Invalidated email jobs SHALL terminate durably as canceled, clear their snapshot and claim, and record a non-sensitive reason rather than success.

#### Scenario: Ambiguous network drop

- **WHEN** a network connection drops after Gmail may have accepted a queued message
- **THEN** a retry uses exactly the same MIME bytes, without switching to SMTP

#### Scenario: Provider switch after an ambiguous attempt

- **WHEN** a frozen Gmail or SMTP email is retried with a different selected provider
- **THEN** it is canceled and scrubbed without calling either provider

#### Scenario: Worker interruption

- **WHEN** a worker stops after snapshot commit but before acknowledgment
- **THEN** a reclaimed attempt uses the persisted snapshot and identical MIME bytes

#### Scenario: Provider failure

- **WHEN** Gmail times out, returns a retryable failure, or returns malformed success
- **THEN** the message remains retryable and is not recorded as delivered

#### Scenario: OAuth authorization needs repair

- **WHEN** the refresh token is revoked or Gmail rejects a refreshed access token
- **THEN** eligible queued mail remains frozen and retryable for operator repair even past its ordinary attempt limit, and a stale access-token 401 receives one refresh and same-MIME retry

#### Scenario: Gmail quota or rate limit

- **WHEN** Gmail responds with HTTP 429 for a queued email
- **THEN** it remains frozen and scheduled for a later retry even after its ordinary attempt limit, without being recorded as delivered

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
