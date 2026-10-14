## MODIFIED Requirements

### Requirement: Signed-in account page

The web application SHALL make the signed-in user's name in the top bar open a protected account page. The page SHALL expose display-name editing, password changing, and account deletion using the current user's existing authenticated account operations. It SHALL present Profile in a centered column, password change beneath the profile information, and Delete account below Profile.

#### Scenario: Open account page
- **WHEN** a signed-in user activates their name from a home or course header
- **THEN** the browser opens the account page with their current name and email

#### Scenario: Unauthenticated account visit
- **WHEN** a visitor without a valid session opens the account page directly
- **THEN** the browser returns to sign-in without showing account information

#### Scenario: Preserve a course draft
- **WHEN** a course editor has an unsaved draft and activates the account link
- **THEN** the existing leave-draft confirmation applies before navigation

#### Scenario: Open account page on a narrow course screen
- **WHEN** a signed-in user views a course on a narrow screen
- **THEN** their name remains visible and operable as the account link

#### Scenario: Account settings order
- **WHEN** a signed-in user opens account settings at desktop or mobile width
- **THEN** Profile and its password control appear in one centered column above Delete account

### Requirement: Account page edits

The account page SHALL save a valid display name using the current profile revision and SHALL update the visible signed-in name after success. It SHALL show only one new-password field in the page, require a new password of 12–128 characters, and request the current password in a separate confirmation dialog before submitting a password change. It SHALL show validation and request errors in red beneath the relevant field and SHALL surface stale requests without claiming success.

#### Scenario: Update display name
- **WHEN** a signed-in user submits a valid changed display name
- **THEN** the page saves it and the top bar reflects the new name

#### Scenario: Reject invalid display name
- **WHEN** a signed-in user submits an empty or otherwise invalid display name
- **THEN** the page does not submit it and shows a red error beneath the display-name field

#### Scenario: Change password
- **WHEN** a signed-in user supplies a valid new password on the page, then supplies the correct current password in the dialog
- **THEN** the page changes the password, clears both password fields, closes the dialog, and reports success

#### Scenario: Reject invalid new password
- **WHEN** the new password is outside the 12–128 character limit
- **THEN** the page does not open the confirmation dialog or submit the change and shows a red error beneath the new-password field

#### Scenario: Cancel password confirmation
- **WHEN** a user cancels the current-password dialog
- **THEN** no password change is submitted and the new-password field remains available for correction

#### Scenario: Reject incorrect current password
- **WHEN** the password change is rejected because the supplied current password is incorrect
- **THEN** the dialog remains open and shows a red error beneath the current-password field

#### Scenario: Profile refresh fails after password change
- **WHEN** the password change succeeds but the follow-up profile refresh fails
- **THEN** the page clears the password fields, reports the password change as successful, reports the refresh failure separately, and retains the last known profile revision

#### Scenario: Stale profile revision
- **WHEN** an account operation receives a revision conflict
- **THEN** the page reloads the profile and tells the user to review the current information before trying again
