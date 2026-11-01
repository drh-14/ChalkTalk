# authentication Specification

## Purpose

Provide verified account identity and secure browser authentication so later ChalkTalk features can identify users and enforce their permissions.

## Requirements

### Requirement: Verified account creation

The system SHALL require a valid, unexpired, single-use email-verification token before creating an account. It SHALL accept verification requests and token-backed account creation only for normalized ASCII addresses of at most 254 characters whose syntactically valid domain ends exactly in `.edu`, including subdomains, without a deployment-specific allowlist. It SHALL create or locate the organization for the exact verified domain, create the user, and consume the token atomically. A rejected token SHALL not create a user or consume the token.

#### Scenario: Verify an academic email

- **WHEN** a client requests verification for a valid mixed-case address under a `.edu` domain or subdomain
- **THEN** the server normalizes it and sends verification without requiring a configured school domain

#### Scenario: Reject a nonacademic domain

- **WHEN** a client requests verification for a syntactically valid email whose domain does not end exactly in `.edu`
- **THEN** the server returns `422 email_domain_not_allowed` without sending mail or persisting a verification token

#### Scenario: Enforce the 254-character mailbox limit

- **WHEN** a client requests verification for a valid 254-character normalized ASCII `.edu` email, or for an otherwise valid 255-character address
- **THEN** the server accepts the 254-character address and returns `422 validation_failed` for the 255-character address without sending mail or persisting a verification token

#### Scenario: Reject malformed email syntax

- **WHEN** a client requests verification for an email with malformed syntax or DNS labels, including a local part outside the 1–64-character ASCII dot-atom form such as `.student@school.edu`, `student..name@school.edu`, `student,admin@school.edu`, a quoted or internationalized local part, or a domain such as `student@.edu`, `student@school.edu.`, `student@bad..edu`, or `student@bad-.edu`
- **THEN** the server returns `422 validation_failed` without sending mail or persisting a verification token

#### Scenario: Reject a malformed legacy verification token

- **WHEN** a previously issued verification token with malformed email syntax, including a local part outside the 1–64-character ASCII dot-atom form, or invalid DNS labels is submitted for account creation or an email change
- **THEN** the server returns `422 validation_failed` without creating or changing a user or consuming the token

#### Scenario: Reject a legacy nonacademic verification token

- **WHEN** a previously issued non-`.edu` verification token is submitted to create an account
- **THEN** the server returns `422 email_domain_not_allowed` without creating a user, organization, or consuming the token

#### Scenario: Create an account from a verified email

- **WHEN** a client submits a valid `.edu` verification token, password, and display name
- **THEN** the system creates the user and returns `201 Created` without returning the password

#### Scenario: Reuse a verification token

- **WHEN** a client submits a token that was already consumed, expired, or superseded
- **THEN** the system rejects account creation without creating a user

#### Scenario: Preserve legacy email access

- **WHEN** an existing non-`.edu` user whose previously accepted local part contains consecutive dots logs in or requests a password reset
- **THEN** historical email normalization finds the account and allows both flows, while a new verification request for that address returns `422 validation_failed`

### Requirement: Browser session authentication

The system SHALL authenticate users with an opaque, server-side session credential in an HttpOnly cookie and SHALL return a session-bound CSRF token after successful login.

#### Scenario: Log in successfully

- **WHEN** a client submits a valid email address and password from an allowed origin
- **THEN** the system creates a session, sets the session cookie, and returns the CSRF token and current user

#### Scenario: Authenticate an unsafe request

- **WHEN** an authenticated unsafe request supplies the valid session cookie, allowed Origin, and matching CSRF token
- **THEN** the system processes the request as the session user

### Requirement: Session and credential lifecycle

The system SHALL support reading the current session, signing out, changing a password, and resetting a forgotten password. Credential-changing operations SHALL revoke affected sessions according to the API contract. For syntactically valid password-reset requests, the system SHALL return the same `202` response no sooner than one second after processing starts whether or not the email exists; existing-account SMTP delivery SHALL be bounded at 750 ms and failures or timeouts SHALL remain hidden.

#### Scenario: Sign out

- **WHEN** an authenticated user deletes the current session
- **THEN** the system revokes the session and expires its browser cookie

#### Scenario: Reset a password

- **WHEN** a client supplies a valid password-reset token and a valid new password
- **THEN** the system changes the password, consumes the token, and revokes existing sessions

### Requirement: Profile and account deletion

The system SHALL allow an authenticated user to update their display name and verified same-school `.edu` email with optimistic concurrency. An email-change token for a different domain or non-`.edu` address SHALL fail with `422 email_domain_not_allowed` without consuming the token or changing the user. Existing non-`.edu` users SHALL retain login and password-reset access. It SHALL require the current password for account deletion and reject deletion when the user is the final instructor of a course.

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

### Requirement: Signed-in account page

The web application SHALL make the signed-in user's name in the top bar open a protected account page. The page SHALL expose display-name editing, password changing, and account deletion using the current user's existing authenticated account operations.

#### Scenario: Open account page

- **WHEN** a signed-in user activates their name from a home or course header
- **THEN** the browser opens the account page with their current name and email

#### Scenario: Unauthenticated account visit

- **WHEN** a visitor without a valid session opens the account page directly
- **THEN** the browser returns to sign-in without showing account information

#### Scenario: Preserve a course draft

- **WHEN** a course editor has an unsaved new-post revision and activates the account link
- **THEN** navigation follows the save-before-leave behavior in the [post-drafts specification](../post-drafts/spec.md); queued attachments still require discard confirmation

#### Scenario: Open account page on a narrow course screen

- **WHEN** a signed-in user views a course on a narrow screen
- **THEN** their name remains visible and operable as the account link

### Requirement: Account page edits

The account page SHALL save a valid display name using the current profile revision and SHALL update the visible signed-in name after success. It SHALL require the current password and a new password of 12–128 characters for a password change, and SHALL confirm the new password before submission. It SHALL surface failed or stale account operations without claiming success.

#### Scenario: Update display name

- **WHEN** a signed-in user submits a valid changed display name
- **THEN** the page saves it and the top bar reflects the new name

#### Scenario: Change password

- **WHEN** a signed-in user supplies their current password and a matching valid new password and confirmation
- **THEN** the page changes the password, clears the password fields, and reports success

#### Scenario: Profile refresh fails after password change

- **WHEN** the password change succeeds but the follow-up profile refresh fails
- **THEN** the page clears the password fields, reports the password change as successful, reports the refresh failure separately, and retains the last known profile revision

#### Scenario: Reject mismatched confirmation

- **WHEN** the new password and its confirmation differ
- **THEN** the page does not submit the change and explains the mismatch

#### Scenario: Stale profile revision

- **WHEN** an account operation receives a revision conflict
- **THEN** the page reloads the profile and tells the user to review the current information before trying again

### Requirement: Confirmed account deletion

The account page SHALL require a distinct confirmation step and the current password before deleting the account. It SHALL tell the user that deletion signs them out and leaves past contributions pseudonymized. A failed request SHALL leave the account page usable and present the server error, including a final-instructor conflict. A successful request SHALL clear local session state and return to sign-in.

#### Scenario: Cancel deletion

- **WHEN** a user opens the deletion confirmation and cancels it
- **THEN** no deletion request is sent

#### Scenario: Confirm deletion

- **WHEN** a user confirms deletion and supplies the correct current password
- **THEN** the account is deleted and the browser returns to sign-in

#### Scenario: Deletion blocked for final instructor

- **WHEN** deletion is rejected because the user is a course's final instructor
- **THEN** the account and session remain active and the page explains the blocker

#### Scenario: Confirm deletion in a short viewport

- **WHEN** a user opens the deletion confirmation in a short landscape viewport
- **THEN** the password field and confirmation actions remain reachable

### Requirement: Password recovery form confirmation

The web application SHALL present new-password and confirmation fields for a valid password-reset link. It SHALL require matching values and a new password of 12–128 characters before submitting the reset request. It SHALL display accessible, red validation feedback beneath the relevant field and SHALL not submit invalid input.

#### Scenario: Mismatched confirmation

- **WHEN** the two password fields differ and the user submits the form
- **THEN** the form displays a mismatch error beneath confirmation and does not call the reset API

#### Scenario: Password violates length restriction

- **WHEN** the new password has fewer than 12 or more than 128 characters and the user submits the form
- **THEN** the form displays a length error beneath the new-password field and does not call the reset API

#### Scenario: Failed reset request

- **WHEN** the reset API rejects a valid form submission
- **THEN** the page displays the failure and remains on the reset form for correction or retry

#### Scenario: Successful reset

- **WHEN** the reset API accepts a valid, matching new password
- **THEN** the application automatically returns to sign-in and displays the existing password-reset success notice

### Requirement: Explicit one-hop reverse proxy trust

The HTTP API SHALL ignore forwarded client-IP headers by default. When deployment configuration explicitly enables exactly one trusted proxy hop, the API SHALL use the client address forwarded by that hop for per-IP authentication rate limits. Invalid hop settings SHALL fail startup.

#### Scenario: Direct local request attempts IP spoofing

- **WHEN** proxy trust is disabled and a direct client sends `X-Forwarded-For`
- **THEN** the forwarded value is ignored for the per-IP limit key

#### Scenario: Request arrives through deployment proxy

- **WHEN** one-hop trust is enabled and Caddy forwards a client's IP
- **THEN** the forwarded client IP is used for the per-IP limit key

### Requirement: Signup form domain validation

The system SHALL reject a non-`.edu` or malformed-domain signup address in the browser before requesting verification, show an accessible error, and leave login and password reset unrestricted by this client-side rule.

#### Scenario: Invalid signup address

- **WHEN** a user submits a non-`.edu` signup email
- **THEN** the form shows an alert and sends no verification request
