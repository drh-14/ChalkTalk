## 1. Specification and test baseline
- [x] 1.1 Validate OpenSpec change and record affected API/database contracts.
- [x] 1.2 Write failing migration, API, lifecycle, socket, email, and browser tests from the approved requirements.

## 2. Persistence and backend
- [x] 2.1 Add forward schema migration preserving legacy session IDs/documents/rosters and finalization confidence.
- [x] 2.2 Replace post-based API authorization and routes with participant-only course-scoped creation/list/detail/invite/management.
- [x] 2.3 Remove post lifecycle coupling; end on creator departure and preserve snapshots; retain idle/archive handling.
- [x] 2.4 Align Hocuspocus ticket/auth/write/revocation behavior with REST; handle transport failures and races.
- [x] 2.5 Update invitation email eligibility and wording.

## 3. Frontend and documentation
- [x] 3.1 Add Collaboration course tab/list/create and update workspace navigation/permissions.
- [x] 3.2 Remove post-specific collaboration actions; preserve home shortcut with participant-only results.
- [x] 3.3 Update OpenAPI, API, database, and user-facing documentation.

## 4. Validation and delivery
- [x] 4.1 Run focused and full tests, formatting, lint, typecheck, build, and OpenSpec validation.
- [x] 4.2 Run isolated authenticated PostgreSQL/API/Hocuspocus/Mailpit/browser failure, race, and network-drop scenarios; capture mocked-browser screenshots.
- [x] 4.3 Archive OpenSpec change after implementation and verification.
