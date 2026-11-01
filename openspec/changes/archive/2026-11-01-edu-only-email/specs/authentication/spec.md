## MODIFIED Requirements

### Requirement: Verified account creation

The system SHALL require a valid, unexpired, single-use email-verification token before creating an account. It SHALL accept verification requests and token-backed account creation only for normalized addresses whose syntactically valid domain ends exactly in `.edu`, including subdomains, without a deployment-specific allowlist. It SHALL create or locate the organization for the exact verified domain, create the user, and consume the token atomically. A rejected token SHALL not create a user or consume the token.

#### Scenario: Verify an academic email

- **WHEN** a client requests verification for a valid mixed-case address under a `.edu` domain or subdomain
- **THEN** the server normalizes it and sends verification without requiring a configured school domain

#### Scenario: Reject a nonacademic domain

- **WHEN** a client requests verification for a syntactically valid email whose domain does not end exactly in `.edu`
- **THEN** the server returns `422 email_domain_not_allowed` without sending mail or persisting a verification token

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

### Requirement: Profile and account deletion

The system SHALL allow an authenticated user to update their display name and verified same-school `.edu` email with optimistic concurrency. An email-change token for a different domain or non-`.edu` address SHALL fail with `422 email_domain_not_allowed` without consuming the token or changing the user. Existing non-`.edu` users SHALL retain login and password-reset access. It SHALL require the current password for account deletion and reject deletion when the user is the final instructor of a course.

#### Scenario: Update a display name with a current ETag

- **WHEN** an authenticated user supplies a matching `If-Match` value and valid display name
- **THEN** the system updates the profile and returns the new ETag

#### Scenario: Protect a course's final instructor

- **WHEN** an authenticated user attempts account deletion while they are the sole instructor of a course
- **THEN** the system returns `409 Conflict` and preserves the account and session

## ADDED Requirements

### Requirement: Signup form domain validation

The system SHALL reject a non-`.edu` or malformed-domain signup address in the browser before requesting verification, show an accessible error, and leave login and password reset unrestricted by this client-side rule.

#### Scenario: Invalid signup address

- **WHEN** a user submits a non-`.edu` signup email
- **THEN** the form shows an alert and sends no verification request
