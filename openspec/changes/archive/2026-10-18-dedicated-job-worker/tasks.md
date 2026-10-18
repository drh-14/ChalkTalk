## 1. Tests
- [x] Add a red test for serialized polling, idle retry, and graceful drain.
- [x] Add a process smoke check that API boot does not claim jobs and worker boot does.

## 2. Implementation
- [x] Add a dedicated worker entrypoint and remove the HTTP poller.
- [x] Start worker in direct dev and Compose `app` profile.
- [x] Document local worker startup.

## 3. Verification
- [x] Run focused tests, integration tests, typecheck, lint, format, build, and Compose config validation.
- [x] Archive the OpenSpec change after verification.
