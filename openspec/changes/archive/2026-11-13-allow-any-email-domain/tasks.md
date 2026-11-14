## 1. Contract and tests

- [x] 1.1 Update authentication API, OpenAPI, design, and database references for any-domain admission and exact-domain grouping.
- [x] 1.2 Write failing API tests for non-`.edu` verification, token-backed signup and organization grouping, same-domain email changes, and retained validation failures.
- [x] 1.3 Write failing web and real-browser signup tests for accepted non-`.edu` addresses and retained invalid-address rejection.

## 2. Implementation

- [x] 2.1 Remove the server `.edu` restriction at verification, signup, and profile-token consumption while retaining syntax checks and same-domain changes.
- [x] 2.2 Remove the browser `.edu` restriction and update academic-only signup copy.

## 3. Verification and delivery

- [x] 3.1 Run focused and repository checks, test the affected signup flow in a real browser with mocked API, and capture screenshots for each visible scenario.
- [ ] 3.2 Archive OpenSpec, run no-mistakes, publish a one-commit draft PR with screenshots, and verify CI on the final head.
