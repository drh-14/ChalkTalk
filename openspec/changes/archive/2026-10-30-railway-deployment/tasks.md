## 1. Gateway and tests

- [x] 1.1 Write failing tests for SPA, API, health, WebSocket, upstream failures, and forwarded-header sanitization.
- [x] 1.2 Rework Caddy and image targets for Railway's plain-HTTP `${PORT}` gateway; pass tests.

## 2. Operator guide

- [x] 2.1 Replace VM Compose and SES env template with exact Railway service, variable, volume, domain, release, and smoke-test instructions.
- [x] 2.2 Document migration failure gate, proxy trust verification, persistent-storage and backup limitations.

## 3. Verification

- [x] 3.1 Validate OpenSpec, build images, exercise gateway tests, and run relevant format/lint checks.
- [x] 3.2 Hand off scoped deployment changes for combined Resend PR gate and publication.
