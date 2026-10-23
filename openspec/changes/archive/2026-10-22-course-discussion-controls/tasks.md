## 1. Course policy contract

- [x] 1.1 Add API integration tests for default policy projection, instructor conditional PATCH, strict validation, student/TA denial, and persistence; verify expected red before implementation and green afterward.
- [x] 1.2 Add migration 051 and extend course service/HTTP projection and update; verify course integration and HTTP contract tests pass.

## 2. Content policy

- [x] 2.1 Add API/database tests for rejected future anonymous/private posts, existing-post preservation, edit transition, policy/update serialization, and post idempotent replay; verify red then green.
- [x] 2.2 Enforce post policy at transactional creation/edit seams; verify post integration tests pass.
- [x] 2.3 Add API/database tests for answer/followup/reply creation policy and idempotent replay; verify red then green.
- [x] 2.4 Enforce answer/followup policy using locked course reads; verify answer/followup integration tests pass.
- [x] 2.5 Add tests for disabled resolution projection, explicit mutation rejection, reply auto-clear freeze, and reenablement; verify red then green.
- [x] 2.6 Implement resolution freeze without changing stored markers and verify followup tests pass.

## 3. Browser and references

- [x] 3.1 Add frontend tests for instructor controls, read-only member policy, restricted composers and conflict/error states; verify red then green.
- [x] 3.2 Implement web course types/settings and relevant composer affordances; verify frontend tests, typecheck, and lint pass.
- [x] 3.3 Update `documentation/api/`, `documentation/openapi.yaml`, and `documentation/database.md`; verify parity with tests and OpenAPI parsing.
- [x] 3.4 Run mocked-API real-browser settings and discussion scenarios, including a rejection edge case, capture a screenshot for each; verify browser tests pass.

## 4. Delivery

- [x] 4.1 Run focused and full relevant checks, archive the validated OpenSpec change, and verify clean scoped diff.
