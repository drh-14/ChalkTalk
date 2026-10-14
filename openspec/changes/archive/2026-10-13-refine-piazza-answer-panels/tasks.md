## 1. Behavior tests

- [x] 1.1 Add a test that the empty answer is collapsed until activated and opens the shared formatting editor.
- [x] 1.2 Update role and create-race tests for the compact prompt and confirm they fail before implementation.

## 2. UI implementation

- [x] 2.1 Add slot-local composer state and prompt/cancel behavior without changing API requests or draft recovery.
- [x] 2.2 Update answer colors and prompt styling, retaining responsive layout and vote location.

## 3. Verification

- [x] 3.1 Run focused UI tests, typecheck, lint, formatting check, and build.
- [x] 3.2 Exercise empty, composer, populated/voted/threaded, and edit flows in a real browser with mocked API; capture screenshots.
- [x] 3.3 Validate and archive the OpenSpec change after successful verification.
