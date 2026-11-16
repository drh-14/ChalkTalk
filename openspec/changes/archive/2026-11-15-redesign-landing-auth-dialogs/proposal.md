## Why

The current split landing page gives a permanent authentication panel as much space as the product introduction. The approved redesign makes ChalkTalk's purpose and features clear first, while keeping authentication immediately accessible.

## What Changes

- Replace the split landing page with a full-width, centered hero and five feature cards using the approved copy and typography.
- Replace inline login, signup-email request, and password-reset request forms with one accessible modal dialog opened from compact header actions; show no dialog on an ordinary visit.
- Open the login dialog with the existing success notice after password-reset completion, and prevent dismissing or switching the dialog while sign-in is pending.
- Keep emailed verification and password-reset completion on their existing dedicated routes, without changing API contracts or token handling.
- Remove the email-domain/course-listing privacy note from the landing/signup entry surface, as requested; grouping behavior is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-auth-entry`: Define the public landing presentation, modal authentication entry behavior, and post-reset login presentation.

## Impact

`apps/web/src/app/App.tsx`, `apps/web/src/styles.css`, related React and browser tests, and the `web-auth-entry` specification. No new dependency, API, database migration, or authentication endpoint is required.
