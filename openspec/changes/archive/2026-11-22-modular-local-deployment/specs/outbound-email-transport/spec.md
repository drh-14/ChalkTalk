## MODIFIED Requirements

### Requirement: Explicit provider selection

Local deployment SHALL require explicit `EMAIL_PROVIDER=resend|sendgrid|ses` and a valid `EMAIL_FROM`, using only the selected provider's HTTPS API. It SHALL require exactly one complete selected provider configuration and reject ANY populated recognized other-provider setting, including partial credentials and legacy SMTP settings. Resend SHALL require `RESEND_API_KEY`; SendGrid SHALL require `SENDGRID_API_KEY`; SES SHALL require `SES_REGION` and `SES_CREDENTIALS_MODE=explicit|default-chain`. SES explicit mode SHALL require `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, with optional `SES_SESSION_TOKEN`. SES default-chain mode SHALL reject any populated SES-prefixed credential field and resolve AWS credentials through the standard chain. Generic `AWS_*` fields SHALL NOT be treated as another mail provider or external S3 configuration. Missing required credential fields or invalid credential mode SHALL fail phase-1 static validation before any build/pull/create/start or external request. Credential validity, source availability, permissions and network reachability SHALL be checked or handled at runtime inside containers before traffic/workers; phase 2 may create containers, but SHALL NOT perform unauthorized provisioning or automatic test sends. There SHALL be no SMTP, mail gateway, arbitrary field mapping, automatic provider fallback, or automatic test email.

Production SHALL remain Resend-only with its fixed verified-domain sender and official `https://api.resend.com` origin; local provider/sender support SHALL NOT bypass production validation. Direct isolated adapter tests MAY use controlled mock transport/origin injection, but normal local startup SHALL NOT permit HTTP mail delivery or arbitrary provider origin overrides. Existing authentication triggers, recipients, content, timeout, and failure semantics SHALL remain unchanged.

#### Scenario: Three complete local providers

- **WHEN** each of Resend, SendGrid, and SES is configured individually with its complete required inputs and sender
- **THEN** verification, password-reset, and queued mail use that provider's HTTPS API with the configured sender and existing content/inline attachments

#### Scenario: Missing selector or sender

- **WHEN** local deployment omits `EMAIL_PROVIDER` or `EMAIL_FROM`, or selects an unsupported provider
- **THEN** it fails before mutation rather than defaulting to SMTP or Resend

#### Scenario: Partial other-provider setting

- **WHEN** any recognized setting for an unselected provider is populated, even without a complete credential pair
- **THEN** startup fails before mutation without exposing its value

#### Scenario: Explicit SES credentials

- **WHEN** SES explicit mode receives its SES-prefixed pair and optional session token
- **THEN** only those credentials are used for SES; a missing half-pair or token-only input fails before mutation

#### Scenario: Default-chain SES credentials

- **WHEN** SES default-chain mode has an operator-explicit container-accessible credential source and no SES-prefixed credential fields
- **THEN** SES retains the SDK credential provider function inside each sending container with explicit `SES_REGION` so refresh can occur
- **AND** populated SES-prefixed keys fail phase 1, while unresolvable/expired source credentials cause redacted phase-2 failure before traffic/workers, without unauthorized provisioning or destructive cleanup

#### Scenario: Refreshable container-local credentials

- **WHEN** default-chain temporary credentials expire while a sending container remains running and its explicit source supplies renewed credentials
- **THEN** the retained SDK provider refreshes them for later sends without changing frozen message content
- **AND** no resolved credential snapshot is exported or reserialized into env files, another container, or queued payloads

#### Scenario: Explicit source access only

- **WHEN** default-chain mode needs profile/config/token files or a workload-role source
- **THEN** the operator explicitly supplies narrowly scoped read-only container-accessible files or an explicitly reachable source
- **AND** startup does not automatically mount home directories, enable host networking, expose metadata, or harvest host credentials

#### Scenario: Explicit temporary credentials expire

- **WHEN** operator-supplied explicit SES temporary credentials expire
- **THEN** runtime failure is redacted and repairable by operator renewal, without provider fallback or automatic credential harvesting

#### Scenario: Production guardrails

- **WHEN** production selects SendGrid, SES, or SMTP, or overrides the Resend origin
- **THEN** startup fails under existing restrictions
- **WHEN** production receives legacy `EMAIL_FROM` with valid Resend configuration
- **THEN** it retains the fixed production sender

#### Scenario: Local development
- **WHEN** the local launcher starts with complete Resend configuration and `EMAIL_FROM`
- **THEN** authentication and queued emails use Resend HTTPS and the configured local sender

#### Scenario: Missing local credentials
- **WHEN** local Resend is selected without its API key
- **THEN** startup fails before mutations

#### Scenario: Production delivery
- **WHEN** production starts with valid Resend configuration
- **THEN** authentication and queued mail use Resend HTTPS with the fixed production sender

#### Scenario: Production SMTP override
- **WHEN** production selects `EMAIL_PROVIDER=smtp`
- **THEN** startup fails instead of sending SMTP

#### Scenario: Production Resend origin override
- **WHEN** production sets a non-official `RESEND_API_BASE_URL`
- **THEN** startup fails rather than sending to that origin

#### Scenario: Local operator authorization
- **WHEN** local Resend is configured
- **THEN** explicit provider, sender and API key are required, with no automatic credential bootstrap or test send

#### Scenario: Configurable local Resend endpoint
- **WHEN** an isolated adapter test injects a controlled mock Resend origin
- **THEN** the test transport can use that origin
- **AND** normal local startup still rejects non-official or HTTP mail origin overrides

#### Scenario: Legacy sender environment setting
- **WHEN** production Resend receives a legacy `EMAIL_FROM`
- **THEN** it retains its fixed verified-domain sender, while local deployment requires and uses its configured sender

### Requirement: Durable identical queued retries

The system SHALL persist each queued message's sender, recipient, text, HTML, inline attachments, selected provider, and frozen provider payload before first network handoff. Each retry SHALL reuse the identical frozen payload only while provider and configured sender still match. A provider or sender change SHALL cancel and scrub the snapshot without calling a provider. Confirmed success or cancellation SHALL clear the snapshot and claim. Only a valid accepted provider response SHALL record delivery success. Invalidated jobs SHALL terminate durably as canceled with a non-sensitive reason. Resend SHALL retain its stable idempotency key within its bounded provider window. SendGrid and SES SHALL NOT be claimed to provide exactly-once delivery: ambiguous acceptance can duplicate on retry.

Retries SHALL be bounded per attempt, scheduled rather than busy-looped, and observable through durable status, attempt count, next availability, and sanitized error classification. Timeouts, throttling, transient failures, ambiguous acceptance, and malformed success SHALL NOT be recorded as success. Configuration/authorization failures SHALL remain repairable without fallback; permanent invalid payloads SHALL terminate under existing worker policy. Logs and persisted errors SHALL NOT expose credentials, connection URLs, tokens, raw provider bodies, or frozen private content.

#### Scenario: Ambiguous acceptance for each provider

- **WHEN** a network response is lost after any selected provider may have accepted a message
- **THEN** the job remains retryable with identical frozen content and selected provider
- **AND** only Resend carries its existing bounded-window idempotency protection; no SendGrid/SES exactly-once guarantee is asserted

#### Scenario: Provider or sender switch

- **WHEN** the configured sender or provider differs from a persisted snapshot, including legacy SMTP snapshots
- **THEN** the worker cancels and scrubs it without any provider request

#### Scenario: Reclaimed worker attempt

- **WHEN** a worker stops after snapshot commit but before acknowledgment
- **THEN** a later claim reuses the committed snapshot and observes normal eligibility checks before handoff

#### Scenario: Observable retry classes

- **WHEN** a provider returns throttle, timeout, transient error, malformed success, or rejected credentials
- **THEN** the queue records no success, retains frozen content for applicable retries/repair, releases the claim, and schedules a future attempt with sanitized classification
- **AND** a permanent invalid request reaches the existing terminal policy without fallback

#### Scenario: Ambiguous network drop
- **WHEN** a network connection drops after Resend may have accepted a queued message
- **THEN** a retry uses the identical provider payload and stable idempotency key without fallback

#### Scenario: Provider switch after an ambiguous attempt
- **WHEN** a frozen email is retried with a different selected provider
- **THEN** it is canceled and scrubbed without calling either provider

#### Scenario: Worker interruption
- **WHEN** a worker stops after snapshot commit but before acknowledgment
- **THEN** a reclaimed attempt uses the persisted snapshot and identical message payload, and retains Resend's stable key when applicable

#### Scenario: Provider failure
- **WHEN** the selected provider times out, returns retryable failure, or malformed success
- **THEN** mail remains retryable under queue policy and is not recorded delivered

#### Scenario: Provider authorization needs repair
- **WHEN** selected provider credentials are rejected
- **THEN** queued mail stays frozen for operator repair without fallback

#### Scenario: Resend quota or rate limit
- **WHEN** Resend responds HTTP 429
- **THEN** mail stays frozen and scheduled for a later retry rather than recorded delivered

### Requirement: Revalidate before each attempt

The system SHALL recheck current recipient address, preferences, membership, course and referenced-content lifecycle, and current visibility before every queued send. It SHALL cancel rather than send if eligibility is lost, if an included title or body changes, if an included actor or sender identity changes or is deleted, if a represented image is deleted, or if the recipient address changes. Included identities and recipient membership deletion SHALL be locked through provider handoff so a committed access or identity change cannot be followed by a stale send. Recipient membership locks SHALL be retained through provider handoff for digests, duplicate notices, invitations, and private-post notifications; an opt-out update to a locked membership MAY wait until the in-flight send finishes, with each selected provider's external request bounded to 30 seconds. An already-started email MAY finish before that opt-out commits. Follow changes receive a final check but MAY finish while a provider send is already in flight. Invalidation SHALL result in zero provider calls on that attempt.

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
