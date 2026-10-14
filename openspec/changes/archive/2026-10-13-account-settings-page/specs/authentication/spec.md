## ADDED Requirements

### Requirement: Signed-in account page

The web application SHALL make the signed-in user's name in the top bar open a protected account page. The page SHALL expose display-name editing, password changing, and account deletion using the current user's existing authenticated account operations.

#### Scenario: Open account page
- **WHEN** a signed-in user activates their name from a home or course header
- **THEN** the browser opens the account page with their current name and email

#### Scenario: Unauthenticated account visit
- **WHEN** a visitor without a valid session opens the account page directly
- **THEN** the browser returns to sign-in without showing account information

#### Scenario: Preserve a course draft
- **WHEN** a course editor has an unsaved draft and activates the account link
- **THEN** the existing leave-draft confirmation applies before navigation

### Requirement: Account page edits

The account page SHALL save a valid display name using the current profile revision and SHALL update the visible signed-in name after success. It SHALL require the current password and a new password of 12–128 characters for a password change, and SHALL confirm the new password before submission. It SHALL surface failed or stale requests without claiming success.

#### Scenario: Update display name
- **WHEN** a signed-in user submits a valid changed display name
- **THEN** the page saves it and the top bar reflects the new name

#### Scenario: Change password
- **WHEN** a signed-in user supplies their current password and a matching valid new password and confirmation
- **THEN** the page changes the password, clears the password fields, and reports success

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
