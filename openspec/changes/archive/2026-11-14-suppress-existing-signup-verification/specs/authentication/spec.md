## ADDED Requirements

### Requirement: Existing-account verification privacy

For a valid verification request whose normalized address already belongs to an active account, the system SHALL create no verification token and send no signup-verification email. It SHALL return the same public `202 Accepted` response and headers as for a new address, preserve per-email and per-IP rate limits and idempotent retries, and hold successful first responses for at least two seconds to reduce account discovery by timing. This applies to the shared verification endpoint used for account creation and same-domain email changes. Account creation SHALL retain its uniqueness check for a token issued before a concurrent account creation.

#### Scenario: Existing account requests verification

- **WHEN** a client requests verification for a valid, case-variant address belonging to an active account
- **THEN** the server returns the same `202 Accepted` response and headers as for a new address, without issuing a token or sending mail

#### Scenario: New address requests verification

- **WHEN** a client requests verification for a valid address not belonging to an active account
- **THEN** the server stores a single-use token and sends the verification mail while returning `202 Accepted`

#### Scenario: Retry existing-account verification

- **WHEN** a client retries a verification request for an existing account with the same idempotency key and body
- **THEN** both requests return the same `202 Accepted` response without mail or token, and conflicting key reuse still fails

#### Scenario: Continue limiting existing-account verification

- **WHEN** repeated valid verification requests target an active account
- **THEN** the existing per-email and per-IP rate limits still apply without disclosing registration through an earlier error

#### Scenario: Account appears after token issuance

- **WHEN** a verification token was issued before another request created an account with the same address
- **THEN** token-backed creation still rejects duplicate account creation without consuming the token

### Requirement: Generic signup verification confirmation

After a successful verification request, the signup page SHALL give generic guidance that a link may arrive and offer sign-in and password-reset paths without revealing whether the address is registered.

#### Scenario: Generic signup confirmation

- **WHEN** a user submits any valid signup email and the verification endpoint returns `202 Accepted`
- **THEN** the page shows the same accessible confirmation and sign-in/password-reset actions regardless of whether an account exists
