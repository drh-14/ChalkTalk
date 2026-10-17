## 1. Test-first reset flow

- [x] 1.1 Add UI tests for mismatch, 12–128-character bounds, API failure, and automatic sign-in success; run them and confirm expected failures before implementation.

## 2. Reset form implementation

- [x] 2.1 Add confirmation, inline accessible errors, and client validation; verify focused UI tests pass.
- [x] 2.2 Redirect after success while retaining the sign-in notice; verify focused UI tests pass.
- [x] 2.3 Add responsive field-error styling; verify rendered browser scenarios at desktop and narrow width.

## 3. Verification and delivery

- [x] 3.1 Run affected/full tests, typecheck, lint, build, and format checks; resolve failures.
- [x] 3.2 Drive request, invalid input, API failure, and success in a real browser with mocked API; capture screenshots of user-visible states.
- [ ] 3.3 Archive the validated OpenSpec change; run no-mistakes and deliver a one-commit draft PR with final-head checks.
