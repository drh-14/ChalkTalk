## Why

Account profile, password, and deletion APIs exist, but signed-in users cannot reach them from the web application. Add an account page accessible from the name in the top bar so these controls are usable.

## What Changes

- Make the signed-in name a link to `/account` from home and course pages.
- Add a protected account page with separate display-name and password forms.
- Require an explicit confirmation and current password before account deletion; explain that contributions remain pseudonymized and deletion can be blocked for a final instructor.
- Keep the displayed session name current after a successful profile update and return to the sign-in page after successful deletion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authentication`: Expose existing account-management operations through the signed-in web UI, with confirmation and protected navigation.

## Impact

Frontend authentication client, app routing and header, account page, styles, UI tests and browser screenshots. Existing account API and database semantics stay in place. No new dependencies or migrations.
