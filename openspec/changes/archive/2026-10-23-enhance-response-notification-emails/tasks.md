## 1. Delivery contract

- [x] 1.1 Add PostgreSQL-backed tests for exact-response email, bounded excerpt, mention deduplication, and legacy job fallback; verify they fail before implementation and pass afterward.
- [x] 1.2 Add PostgreSQL-backed suppression tests for unfollow, read notification, opt-out, lost membership/visibility, deleted response, and anonymous identity; verify they fail before implementation where behavior is missing and pass afterward.
- [x] 1.3 Carry optional response references from answer/followup creation through existing follower/mention jobs and implement delivery-time checks, excerpt, and fragment URL; verify worker integration tests pass.

## 2. Browser navigation

- [x] 2.1 Add browser-facing tests for answer, root followup, nested off-page reply, and unavailable target links; verify failing assertions before implementation and passing afterward.
- [x] 2.2 Add stable answer/followup DOM targets, authorized ancestor-path loading, and focus/scroll navigation; verify browser tests and screenshots for visible scenarios.

## 3. End-to-end verification and delivery

- [x] 3.1 Document email/link behavior and run typecheck, build, lint, formatting, focused tests, and OpenSpec validation; verify commands pass.
- [x] 3.2 Run isolated disposable PostgreSQL + API + worker + Mailpit + browser with mock accounts, inspect delivered MIME and exact-link landing; verify actual SMTP delivery and screenshots.
- [x] 3.3 Archive the verified OpenSpec change and confirm its response-email capability appears in main specs.
