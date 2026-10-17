## ADDED Requirements

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
