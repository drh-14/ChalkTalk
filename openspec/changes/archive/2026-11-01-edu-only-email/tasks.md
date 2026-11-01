## 1. Contract and tests

- [x] 1.1 Update auth/OpenAPI/database references for `.edu` admission and retained same-school boundaries.
- [x] 1.2 Add failing server tests for accepted domains, malformed/lookalike rejection, idempotent verification, token-backed creation, and profile-change persistence.
- [x] 1.3 Add failing signup form tests for prefetch rejection and accepted `.edu` addresses.

## 2. Implementation

- [x] 2.1 Remove allowlist config and enforce `.edu` domain policy at all server boundaries.
- [x] 2.2 Validate signup form before fetch and show an accessible error.
- [x] 2.3 Remove obsolete env/deployment documentation.

## 3. Verification and delivery

- [x] 3.1 Run focused/full tests, typecheck, lint, format, and a mocked-API real-browser signup flow with screenshots.
- [ ] 3.2 Validate and archive OpenSpec, run no-mistakes, publish one-commit draft PR, and verify final CI/head.
