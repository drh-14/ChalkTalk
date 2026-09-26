## Purpose

Provide a secure, accessible browser entry experience that lets ChalkTalk users authenticate and reach an initial protected course-discussion home page.

## ADDED Requirements

### Requirement: Public authentication entry

The browser application SHALL provide landing-page flows for login, requesting verified signup email, creating an account from an emailed verification token, requesting a password reset, and completing a password reset from an emailed token.

#### Scenario: Login reaches the protected home page

- **WHEN** a visitor submits valid login credentials
- **THEN** the browser stores the returned session only in memory and navigates to `/home`

#### Scenario: Verification link creates an account

- **WHEN** a visitor opens a valid verification link and submits valid account details
- **THEN** the browser creates the account, authenticates the new user, and navigates to `/home`

#### Scenario: Password reset completion returns to login

- **WHEN** a visitor completes a valid password reset from an emailed link
- **THEN** the browser presents a reset-success notice and navigates to the login flow

### Requirement: Protected placeholder home

The browser application SHALL protect `/home` by restoring the current browser session before rendering static placeholder course and post content.

#### Scenario: Unauthenticated visitor opens home

- **WHEN** an unauthenticated visitor navigates directly to `/home`
- **THEN** the browser replaces the route with `/` and renders the public landing page

#### Scenario: Signed-in visitor opens home

- **WHEN** a signed-in visitor opens or refreshes `/home`
- **THEN** the browser renders static course and post placeholders and offers sign-out

### Requirement: Browser credential and token handling

The browser application SHALL use relative API requests with browser credentials, retain session and CSRF material only in memory, and remove emailed verification or reset tokens from the visible browser URL after route initialization.

#### Scenario: Emailed token route initializes

- **WHEN** a visitor opens `/verify-email` or `/reset-password` with a nonempty token query parameter
- **THEN** the browser retains the token only for the active form and replaces the visible URL without the token query parameter

#### Scenario: Sign out ends the current session

- **WHEN** a signed-in visitor selects sign out
- **THEN** the browser sends the session-bound CSRF token, clears its in-memory session state, and navigates to `/`

### Requirement: Accessible auth feedback

The browser application SHALL label every auth form control, prevent duplicate submissions while a request is pending, and expose status or error feedback to assistive technology.

#### Scenario: Auth request fails

- **WHEN** an authentication request fails
- **THEN** the active form remains available, restores its submit control, and presents a concise error or rate-limit retry message in a live region
