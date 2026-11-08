## MODIFIED Requirements

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
