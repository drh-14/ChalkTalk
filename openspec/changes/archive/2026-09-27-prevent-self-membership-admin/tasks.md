## 1. Contract and red tests

- [x] 1.1 Validate the OpenSpec proposal, design, spec, and tasks strictly before application code.
- [x] 1.2 Add failing PostgreSQL-backed HTTP tests for self-targeted conditional role PATCH and explicit DELETE returning `403 permission_denied` with unchanged membership/version when another instructor exists; include no-op PATCH and existing authorization/428/412 precedence where relevant.
- [x] 1.3 Add or adapt tests confirming other-member administration, `/members/me` self-leave, and last-instructor protection remain unchanged.
- [x] 1.4 Add a failing rendered Course settings test showing that the own roster row omits role/Remove controls while another member's row retains them, including pagination where the own row is not initially present.

## 2. Implementation and references

- [x] 2.1 Add self-target checks inside the membership service after existing actor, target, and ETag checks and before mutations, returning `403 permission_denied` without changing data.
- [x] 2.2 Hide own-row administration controls in Course settings using the existing signed-in user ID; leave other rows and dedicated Leave course behavior unchanged.
- [x] 2.3 Update `documentation/api/course-memberships.md` and `documentation/openapi.yaml` for the new 403 cases and unchanged `/members/me` distinction.

## 3. Verification

- [x] 3.1 Run focused and full PostgreSQL/API and frontend tests, lint, typecheck, formatting, build, strict OpenSpec validation, and relevant Compose smoke checks.
- [x] 3.2 Record verification and archive the OpenSpec change after implementation is complete.
