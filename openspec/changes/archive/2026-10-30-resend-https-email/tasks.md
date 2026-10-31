## 1. Contract and schema

- [x] 1.1 Add versioned nullable frozen-message columns and document persistence constraints.
- [x] 1.2 Add explicit provider configuration, Resend HTTPS adapter, and local SMTP regression coverage, using tests-first behavior slices.

## 2. Queued delivery

- [x] 2.1 Add tests for job snapshot commit, exact retry payload/key, success cleanup, and network/provider failures; implement worker behavior.
- [x] 2.2 Add tests for every queued job's address, preference, content, and lifecycle invalidation; implement cancellation before provider calls.
- [x] 2.3 Add digest tests for frozen inline images, exact retry, whole-digest invalidation, lease/crash behavior, and cleanup; implement digest behavior.

## 3. Delivery verification

- [x] 3.1 Update deployment and operator documentation for `EMAIL_PROVIDER`, `EMAIL_FROM`, and `RESEND_API_KEY`; keep Mailpit instructions.
- [x] 3.2 Run focused and broad tests, typecheck, lint, build, formatting, and isolated PostgreSQL scenarios; resolve findings.
- [x] 3.3 Archive OpenSpec after verification and hand the combined change to the no-mistakes publication gate.
