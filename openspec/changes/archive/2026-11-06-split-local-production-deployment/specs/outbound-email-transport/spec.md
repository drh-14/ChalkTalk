## MODIFIED Requirements

### Requirement: Explicit provider selection

Normal local and production deployment SHALL use Resend HTTPS, with an API key and verified sender required at startup. Neither Compose stack SHALL run Mailpit or send through SMTP. The local test environment MAY use an HTTP or HTTPS mock Resend origin. Production SHALL reject SMTP selection and SHALL NOT fall back to another provider. Existing mail triggers, recipients, and content SHALL be unchanged.

#### Scenario: Local development

- **WHEN** the local Compose application starts with sender and Resend key
- **THEN** authentication and queued emails use Resend HTTPS

#### Scenario: Missing production credentials

- **WHEN** the local application starts without a Resend key or sender
- **THEN** startup fails clearly

#### Scenario: Production delivery

- **WHEN** the production application starts with valid Resend configuration
- **THEN** authentication and queued emails use Resend HTTPS

#### Scenario: Production SMTP override

- **WHEN** a production process sets `EMAIL_PROVIDER=smtp`
- **THEN** startup fails rather than sending through SMTP

#### Scenario: Local operator authorization

- **WHEN** an operator configures Resend delivery
- **THEN** only the API key and verified sender are required; no extra credential bootstrap is performed

#### Scenario: Configurable local Resend endpoint

- **WHEN** Resend is configured with a valid alternate API origin for testing
- **THEN** the client sends to that origin
