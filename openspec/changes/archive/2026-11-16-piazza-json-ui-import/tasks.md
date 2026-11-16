## 1. Contract and failing tests

- [x] 1.1 Document `POST /api/v1/piazza-imports` in API and OpenAPI references and verify contract consistency with a focused documentation check.
- [x] 1.2 Add adapter tests for valid CLI JSON, private-only identity filtering, malformed/deep/large payloads, and run them to confirm the expected pre-implementation failure.
- [x] 1.3 Add HTTP/database integration tests for first import, locked instructor re-import, unauthorized/cross-organization attempts, auth/CSRF/origin, rollback, and temporary-file cleanup; confirm expected failures.
- [x] 1.4 Add frontend unit and real-browser mocked-API tests for preview, consent, success, validation failure, and retry; confirm expected failures and capture eventual screenshots.

## 2. Implementation

- [x] 2.1 Add an endpoint-specific 20 MiB multipart limit without changing existing uploads; verify parser tests pass.
- [x] 2.2 Implement bounded JSON validation and private-content filtering; verify adapter tests pass.
- [x] 2.3 Enforce UI-only re-import authorization inside the importer transaction after the advisory lock and add the authenticated HTTP route; verify integration tests pass and CLI tests remain unchanged.
- [x] 2.4 Add the CourseHome import action, preview, confirmation, request client, pending/error states, and navigation; verify unit and browser tests pass with screenshots.

## 3. Delivery

- [x] 3.1 Run focused tests, typecheck, lint, format, browser scenarios, and OpenSpec validation; fix any failures.
