## 1. Specification Tests

- [x] 1.1 Add component tests for opening/canceling both confirmations, successful requests, keyboard/focus behavior, failure recovery, and stale-version reconfirmation; run them red against current UI.

## 2. UI Implementation

- [x] 2.1 Implement the accessible confirmation dialog and route both destructive controls through it; verify component tests pass.
- [x] 2.2 Preserve conditional request and refreshed retry behavior, requiring reconfirmation after a stale response; verify focused component tests pass.

## 3. Browser Evidence and Delivery

- [x] 3.1 Add mocked-API browser tests for member and course confirmation, cancellation, and error recovery; capture screenshots for the visible scenarios and verify Playwright passes.
- [x] 3.2 Run typecheck, lint, formatting and relevant tests; archive the OpenSpec change after verification.
