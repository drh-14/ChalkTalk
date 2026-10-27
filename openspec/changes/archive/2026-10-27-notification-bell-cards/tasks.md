## 1. Contract and persistence

- [x] 1.1 Add migration and API/database documentation; verify schema tests cover kinds, targets, and legacy rows.
- [x] 1.2 Write notification API/database tests first and confirm expected red failures for secure previews, destinations, moderation, and pagination visibility.

## 2. Backend implementation

- [x] 2.1 Persist response references and moderation events atomically; verify focused service tests pass.
- [x] 2.2 Project authorized response and moderation cards from current state; verify list and count integration tests pass.

## 3. Browser and delivery

- [x] 3.1 Write red bell UI tests, then implement rectangular cards and Load more; verify focused React tests pass.
- [x] 3.2 Run mocked-browser flows and save a screenshot for every visible scenario; verify golden and edge cases.
- [x] 3.3 Run build, typecheck, lint, formatting, OpenSpec validation, and no-mistakes; archive OpenSpec and publish a one-commit draft PR with final-head CI.
