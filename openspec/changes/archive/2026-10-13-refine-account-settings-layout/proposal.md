## Why

The account page splits Profile and Password into side-by-side cards, making related settings harder to scan. Password changes also require three visible fields when the intended flow needs one new-password field and a separate current-password confirmation.

## What Changes

- Center the account settings content in one column, with password change under Profile and Delete account below it.
- Show one New password field on the page. Request the current password in an accessible dialog when a valid new password is submitted.
- Show red, field-associated errors beneath invalid inputs, including password length and server validation failures.
- Preserve the existing password API, optimistic concurrency, and account deletion behavior.

## Capabilities

### Modified Capabilities

- `authentication`: Revise the account page layout and password-change interaction.

## Impact

Frontend account page, styles, account-page tests, and browser screenshots. No backend or dependency changes.
