## 1. Contract and tests

- [x] 1.1 Add a failing test that OCR configuration cannot be changed by environment values; verify the focused test fails for the expected reason.

## 2. Implementation

- [x] 2.1 Move the 200-page/English configuration into `config/constants.ts`, remove environment parsing, and verify focused tests pass.
- [x] 2.2 Remove obsolete entries from local and production templates and documentation; verify a repository search finds no active instructions to set them.

## 3. Validation

- [x] 3.1 Run OpenSpec strict validation, relevant tests, typecheck, lint and format checks; archive the completed change.
