## Why

The existing emailed password-reset link opens a form with one password field and requires a second click after success. A confirmation field and automatic return to sign-in reduce mistyped resets and complete the recovery flow.

## What Changes

- Add password confirmation and inline, accessible validation for mismatch and the existing 12–128-character restriction.
- Keep invalid submissions on the page without calling the API; keep API failures visible on the form.
- After a successful reset, return automatically to sign-in with the existing success notice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authentication`: Define the web reset form's confirmation, validation, and completion behavior.

## Impact

Frontend reset page, auth UI tests/styles, and browser evidence. The email, token, API, and database behavior remain unchanged. No new dependency or migration.
