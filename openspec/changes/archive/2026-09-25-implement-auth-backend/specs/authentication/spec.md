## Purpose

Provide verified account identity and secure browser authentication so later ChalkTalk features can identify users and enforce their permissions.

## ADDED Requirements

### Requirement: Verified account creation

The system SHALL require a valid, unexpired, single-use email-verification token before creating an account. It SHALL create or locate the organization for the verified school domain, create the user, and consume the token atomically.

#### Scenario: Create an account from a verified email

- **WHEN** a client submits a valid verification token, password, and display name
- **THEN** the system creates the user and returns `201 Created` without returning the password

#### Scenario: Reuse a verification token

- **WHEN** a client submits a token that was already consumed, expired, or superseded
- **THEN** the system rejects account creation without creating a user

### Requirement: Browser session authentication

The system SHALL authenticate users with an opaque, server-side session credential in an HttpOnly cookie and SHALL return a session-bound CSRF token after successful login.

#### Scenario: Log in successfully

- **WHEN** a client submits a valid email address and password from an allowed origin
- **THEN** the system creates a session, sets the session cookie, and returns the CSRF token and current user

#### Scenario: Authenticate an unsafe request

- **WHEN** an authenticated unsafe request supplies the valid session cookie, allowed Origin, and matching CSRF token
- **THEN** the system processes the request as the session user

### Requirement: Session and credential lifecycle

The system SHALL support reading the current session, signing out, changing a password, and resetting a forgotten password. Credential-changing operations SHALL revoke affected sessions according to the API contract.

#### Scenario: Sign out

- **WHEN** an authenticated user deletes the current session
- **THEN** the system revokes the session and expires its browser cookie

#### Scenario: Reset a password

- **WHEN** a client supplies a valid password-reset token and a valid new password
- **THEN** the system changes the password, consumes the token, and revokes existing sessions

### Requirement: Profile and account deletion

The system SHALL allow an authenticated user to update their display name and verified same-school email with optimistic concurrency. It SHALL require the current password for account deletion and reject deletion when the user is the final instructor of a course.

#### Scenario: Update a display name with a current ETag

- **WHEN** an authenticated user supplies a matching `If-Match` value and valid display name
- **THEN** the system updates the profile and returns the new ETag

#### Scenario: Protect a course's final instructor

- **WHEN** an authenticated user attempts account deletion while they are the sole instructor of a course
- **THEN** the system returns `409 Conflict` and preserves the account and session

### Requirement: Local development parity

The system SHALL support browser authentication locally over HTTPS with the same secure production cookie attributes and SHALL capture development emails without delivering them to external recipients.

#### Scenario: View a local verification email

- **WHEN** a local verification request requires delivery
- **THEN** the message is available in the configured local SMTP capture inbox
