## 1. Specification-driven tests

- [x] 1.1 Add or update `apps/web/src/app/App.test.tsx` assertions for the exact landing copy, five cards, absent privacy note, no dialog by default, dialog flow switching, reset-success login opening, and pending sign-in lock; run the focused test and confirm expected failures before implementation
- [x] 1.2 Update `tests/browser/signup-email.spec.mjs` and `tests/browser/local-caddy-gateway.spec.mjs`, and add mocked-API browser coverage for login/signup/reset modal behavior, focus and dismissal, pending-login failure/success, email-link routes, and responsive layout; verify the affected browser specs pass

## 2. Landing and authentication UI

- [x] 2.1 Replace the split landing layout in `apps/web/src/app/App.tsx` with the approved full-width hero, header actions, and five feature cards; verify the focused React tests pass for content and default state
- [x] 2.2 Place login, signup request, and reset request forms in one native dialog with accessible naming, initial focus, focus return, Escape/backdrop/close handling, and state reset; verify the focused React and browser interaction tests pass
- [x] 2.3 Keep the dialog visible and panel selection fixed during pending sign-in, then restore dismissal after failure or navigate after success; verify pending-state tests pass
- [x] 2.4 Open Log in with the existing success notice after reset completion while retaining dedicated email-link routes and token scrubbing; verify reset and verification-route tests pass
- [x] 2.5 Update `apps/web/src/styles.css` for approved typography, card layout, and viewport-contained responsive dialog; verify desktop and narrow-screen browser assertions and screenshots match the approved mockups

## 3. Validation

- [x] 3.1 Run affected React tests, full relevant web tests, lint/type checks, and real-browser mocked-API flows; verify all pass and save a screenshot for each user-visible scenario
- [x] 3.2 Run `openspec validate redesign-landing-auth-dialogs --strict` and sync the accepted delta into `openspec/specs/web-auth-entry/spec.md`; verify both commands succeed
