## 1. Contract and red tests

- [x] 1.1 Document lock API, response flag, migration, and errors from API/database references; add PostgreSQL-backed tests for authorization, validation, ETags, persistence, idempotent toggle, and unchanged feed order. Confirm expected failures before code.
- [x] 1.2 Add tests for answer/followup/reply creation, all upvote changes, poll vote/unvote, and concurrency at the parent-row lock. Confirm expected failures before code.
- [x] 1.3 Add UI tests for badge, staff toggle, disabled creation/voting, preserved edits and resolution. Confirm expected failures before code.

## 2. Implementation

- [x] 2.1 Add migration, post projection, dedicated conditional staff route, and service toggle.
- [x] 2.2 Enforce lock under parent-post row lock in all existing create/vote paths, including poll unvote.
- [x] 2.3 Add feed/detail lock badge, toggle, and participation-disable UI for questions and polls.

## 3. Verification and delivery

- [x] 3.1 Run focused PostgreSQL/API/web tests, lint/typecheck/build, and strict OpenSpec validation; sync/archive completed OpenSpec.
- [x] 3.2 Run mocked-API real-browser flows for staff lock/unlock and student locked question/poll, capture screenshots for each scenario.
- [x] 3.3 Confirm the implemented contract and screenshots are complete, then archive this OpenSpec change. Draft-PR publication, no-mistakes validation, one-commit squash, and final-head CI are delivery gates after the specification work.
