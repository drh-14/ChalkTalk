## 1. Contracts and persistence

- [x] 1.1 Add test-first migration and service coverage for followup Yjs backfill, ticket lifetime/consumption, current role checks, and live-empty constraints.
- [x] 1.2 Implement PostgreSQL schema and transactional answer/followup document writes, attribution, endorsement clearing, and lifecycle locks.
- [x] 1.3 Add API ticket endpoints and synchronize conditional REST edits with active collaboration documents.

## 2. Collaboration transport

- [x] 2.1 Add tests proving SyncStep2 and Update cannot apply/broadcast before PostgreSQL commit, including rejected and duplicate updates.
- [x] 2.2 Implement separate Hocuspocus server, ticket authentication, per-update authorization/validation, Redis fanout and fail-closed recovery.
- [x] 2.3 Verify two real nodes and Redis against PostgreSQL: convergence, role revocation, REST/live races, outage and reconnect.

## 3. Browser and documentation

- [x] 3.1 Test-first CodeMirror/Yjs binding for answers and followups, formatting toolbar, rejection/draft state, and anonymous awareness.
- [x] 3.2 Run affected UI flows in a real browser with mocked API/WebSocket and capture screenshots.
- [x] 3.3 Update API/OpenAPI/database/deployment documentation and run tests, typecheck, lint, build, and strict OpenSpec validation.
