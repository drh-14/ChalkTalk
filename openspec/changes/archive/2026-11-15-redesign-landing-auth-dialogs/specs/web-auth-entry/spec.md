## ADDED Requirements

### Requirement: Product-first public landing

The browser application SHALL present a full-width public landing page that introduces ChalkTalk before requesting authentication, with compact Log in and Create account actions. It SHALL show no authentication dialog on an ordinary unauthenticated arrival at `/`.

#### Scenario: Visitor arrives at the landing page

- **WHEN** an unauthenticated visitor opens `/` without a completed password-reset notice
- **THEN** the page shows the centered heading `Your all in one course Q & A platform`, supporting text `One focused place for course information, questions and announcements.`, and no open auth dialog

#### Scenario: Visitor reads the feature section

- **WHEN** a visitor scrolls below the hero
- **THEN** the page shows `Everything your course needs, together.` without a subtitle and five feature cards: Course Q&A, Announcements & course info, Organized resources, Notifications, and Live collaboration
- **AND** their descriptions are respectively `Ask questions, share answers, and follow up in organized discussions`, `Keep essential updates and class details easy to find`, `Bring course files, links, and materials into one place`, `Stay on top of replies and course activity that matter to you`, and `Work together in shared sessions, code, and whiteboards`, without final periods

### Requirement: Accessible modal authentication entry

The browser application SHALL offer login, verified-signup email request, and password-reset request inside one accessible modal dialog on the landing page. Opening the dialog SHALL focus the active form, keep background content unavailable to keyboard interaction, and allow dismissal by a labelled close control, Escape, or backdrop interaction when no sign-in request is pending. Dismissal SHALL return focus to the opening header action and clear transient form state.

#### Scenario: Open and switch auth flows

- **WHEN** a visitor selects Log in or Create account in the header, or switches among login, signup request, and reset request within the dialog
- **THEN** the requested form is shown in the same modal shell with an accessible name and focus on its first useful field

#### Scenario: Dismiss an idle dialog

- **WHEN** a visitor uses the close control, Escape, or backdrop while sign-in is not pending
- **THEN** the dialog closes, transient form values and feedback are cleared, and focus returns to the action that opened it

#### Scenario: Sign-in remains visible until resolved

- **WHEN** a login submission is pending
- **THEN** the visitor cannot dismiss the dialog or switch auth forms
- **AND** on failure the existing error feedback appears and dismissal is restored, or on success the browser navigates to `/home`

#### Scenario: Authenticated restoration takes precedence

- **WHEN** the application restores a valid session while entering `/`
- **THEN** it navigates to `/home` rather than displaying a public auth dialog

### Requirement: Email-link completion remains on dedicated routes

The browser application SHALL keep account completion and password-reset completion on their existing emailed-token routes and SHALL continue removing token query parameters from the visible URL. A successful password reset SHALL return to `/`, open the login dialog automatically, and display the existing reset-success notice there.

#### Scenario: Password reset succeeds

- **WHEN** a visitor completes a valid password reset from `/reset-password?token=...`
- **THEN** the browser returns to `/` with the Log in dialog open and the reset-success notice visible

#### Scenario: Verification or reset link is invalid

- **WHEN** a visitor follows an invalid or missing emailed verification or reset token
- **THEN** the existing dedicated link-problem experience is shown rather than an empty landing dialog

#### Scenario: Token route initializes

- **WHEN** a valid verification or reset link opens
- **THEN** the browser retains the token only for the active completion form and removes it from the visible URL
