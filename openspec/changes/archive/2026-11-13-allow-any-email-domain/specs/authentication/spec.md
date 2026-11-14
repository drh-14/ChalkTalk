## MODIFIED Requirements

### Requirement: Verified account creation

The system SHALL require a valid, unexpired, single-use email-verification token before creating an account. It SHALL accept verification requests and token-backed account creation for normalized ASCII addresses of at most 254 characters with a 1–64-character ASCII dot-atom local part and syntactically valid DNS domain, regardless of domain suffix. It SHALL create or locate the organization for the exact verified domain, create the user, and consume the token atomically. A rejected token SHALL not create a user or consume the token.

#### Scenario: Verify an email at any domain

- **WHEN** a client requests verification for a valid mixed-case address under a `.edu` domain, subdomain, or public-provider domain
- **THEN** the server normalizes it and sends verification without requiring an academic suffix

#### Scenario: Reject malformed syntax at a nonacademic domain

- **WHEN** a client requests verification for an email with a nonacademic domain and malformed local-part or DNS syntax
- **THEN** the server returns `422 validation_failed` without sending mail or persisting a verification token

#### Scenario: Enforce the 254-character mailbox limit

- **WHEN** a client requests verification for a valid 254-character normalized ASCII email, or for an otherwise valid 255-character address
- **THEN** the server accepts the 254-character address and returns `422 validation_failed` for the 255-character address without sending mail or persisting a verification token

#### Scenario: Reject malformed email syntax

- **WHEN** a client requests verification for an email with malformed syntax or DNS labels, including a local part outside the 1–64-character ASCII dot-atom form such as `.student@school.edu`, `student..name@school.edu`, `student,admin@school.edu`, a quoted or internationalized local part, or a domain such as `student@.edu`, `student@school.edu.`, `student@bad..edu`, or `student@bad-.edu`
- **THEN** the server returns `422 validation_failed` without sending mail or persisting a verification token

#### Scenario: Reject a malformed legacy verification token

- **WHEN** a previously issued verification token with malformed email syntax, including a local part outside the 1–64-character ASCII dot-atom form, or invalid DNS labels is submitted for account creation or an email change
- **THEN** the server returns `422 validation_failed` without creating or changing a user or consuming the token

#### Scenario: Reject a malformed legacy nonacademic verification token

- **WHEN** a previously issued non-`.edu` verification token with malformed email syntax is submitted to create an account
- **THEN** the server returns `422 validation_failed` without creating a user, organization, or consuming the token

#### Scenario: Create an account from a verified email

- **WHEN** a client submits a valid verification token from any email domain, password, and display name
- **THEN** the system creates the user and returns `201 Created` without returning the password

#### Scenario: Reuse a verification token

- **WHEN** a client submits a token that was already consumed, expired, or superseded
- **THEN** the system rejects account creation without creating a user

#### Scenario: Preserve legacy email access

- **WHEN** an existing non-`.edu` user whose previously accepted local part contains consecutive dots logs in or requests a password reset
- **THEN** historical email normalization finds the account and allows both flows, while a new verification request for that address returns `422 validation_failed`

#### Scenario: Share an organization at a public email domain

- **WHEN** two users register verified addresses at the same public email domain
- **THEN** both are associated with the same exact-domain organization and can access its organization-level course listing under existing authorization rules

### Requirement: Profile and account deletion

The system SHALL allow an authenticated user to update their display name and verified email within their current exact domain with optimistic concurrency. An email-change token for a different domain SHALL fail with `422 email_domain_not_allowed` without consuming the token or changing the user. It SHALL require the current password for account deletion and reject deletion when the user is the final instructor of a course.

#### Scenario: Update a display name with a current ETag

- **WHEN** an authenticated user supplies a matching `If-Match` value and valid display name
- **THEN** the system updates the profile and returns the new ETag

#### Scenario: Protect a course's final instructor

- **WHEN** an authenticated user attempts account deletion while they are the sole instructor of a course
- **THEN** the system returns `409 Conflict` and preserves the account and session

#### Scenario: Change an email within a nonacademic domain

- **WHEN** an authenticated user provides a valid verified replacement address at their current non-`.edu` domain with a matching `If-Match` value
- **THEN** the system updates the email while preserving the organization

#### Scenario: Reject a cross-domain email change

- **WHEN** a user provides a valid verified replacement address at another domain
- **THEN** the system returns `422 email_domain_not_allowed` without changing the account or consuming the proof

### Requirement: Signup form email validation

The system SHALL accept a syntactically valid signup address at any domain and reject malformed or overlong addresses in the browser before requesting verification, show an accessible error, and leave login and password reset unrestricted by this client-side rule.

#### Scenario: Invalid signup address

- **WHEN** a user submits a malformed signup email
- **THEN** the form shows an alert and sends no verification request

#### Scenario: Submit a nonacademic signup email

- **WHEN** a user submits a valid non-`.edu` signup email
- **THEN** the form requests verification and shows its normal confirmation
