## Context

See [proposal.md](proposal.md) for motivation and [web-auth-entry delta](specs/web-auth-entry/spec.md) for required behavior. `apps/web/src/app/App.tsx` currently contains the split `Landing` view, three inline request forms, and the route/session logic. `apps/web/src/styles.css` contains the landing layout and mobile rules. The existing signup and local-gateway browser tests assume always-visible inline forms. The detailed structural design and alternatives are recorded in [the dated design document](../../../documentation/design/2026-11-15-landing-auth-dialogs.md).

## Goals / Non-Goals

- Preserve the current auth client, API contracts, session restoration, and emailed-token completion routes.
- Make the public entry accessible on keyboard, pointer, and narrow-screen use without adding a dependency.
- Keep the new form-selection state local to the landing page rather than introducing route or query-parameter semantics.
- Do not change email-domain grouping, verification, password-reset security, or authenticated application pages.

## Decisions

### One native modal shell

Use a single native `<dialog>` and render the active login, signup-email request, or reset-email request form within it. Native `showModal()` provides focus containment and an inert background. Give it an accessible name, focus the first useful field on opening or switching, handle close button/Escape/backdrop consistently, and restore focus to the header opener. Clear transient form state and notices on close. A custom modal was rejected because it would require manual inert/focus handling; a modal dependency is unnecessary for one shell.

### Landing-local state, existing token routes

`Landing` owns only which panel is open. `App` retains route, session, and post-reset notice ownership; the forms retain values, pending state, validation, and feedback. Do not place ordinary panel state in the URL. Keep `/verify-email?token=...` and `/reset-password?token=...` on their dedicated pages and preserve the existing URL token scrub. On reset completion, navigate to `/`, initialize Log in as open, and show the existing notice. A route-driven ordinary dialog was rejected as needless navigation complexity; moving token completion into the dialog would disturb security-sensitive link handling.

### Pending sign-in cannot be hidden

While login is submitting, block close button, Escape, backdrop, and form switching. A pending login can establish a server session even if the user dismisses the UI, so hiding it risks a stale logged-out display. Restore controls on failure; successful login follows the existing `/home` navigation. Signup and reset-request submissions may remain dismissible because they do not establish a session.

### Visual implementation

Replace the two-column hero with the approved full-width centered composition and five cards. Use existing Fraunces for the main heading and existing DM Sans for its ampersand, keeping `Q & A` together; increase the ChalkTalk wordmark about 30%. Follow the approved exact copy in the spec, omit the feature subtitle, remove final card-description periods, and remove the old email-domain/course-listing privacy note. Keep the dialog viewport-contained and internally scrollable at narrow widths and with enlarged text. No new font asset is required.

## Risks / Trade-offs

- Native `<dialog>` methods are incomplete in jsdom → use a minimal test shim where needed and treat real-browser tests as authoritative for focus, Escape, backdrop, and inert background.
- Async login completes after attempted dismissal → guard every dismissal/switch path while pending and cover failure and success in browser tests.
- Responsive dialog becomes taller than the viewport → constrain height and allow internal scroll; verify desktop and mobile screenshots.
- Removing the privacy note removes entry-surface disclosure of existing grouping behavior → this is an explicit user choice; no grouping logic changes.
- Ordinary dialog selection is not deep-linkable and resets on refresh → acceptable for transient entry flows.

## Migration Plan

No data or API migration. Deploy the frontend change atomically with tests. Existing emailed links remain valid. Rollback is the previous frontend build; no persisted state needs reversal.
