# Tasks

## 1. Viewers on the server

- [x] 1.1 Add migration `023_collaboration_participant_permission.sql`, `permission` in `invite` and the participant projection (design D1), and document it in `database.md`, `collaboration-sessions.md`, and `openapi.yaml`; verify HTTP tests for each permission, the default, an invalid value, unchanged permission on re-invite, and the participant field
- [x] 1.2 Issue `read` tickets for viewers and report `permission` in the ticket response (design D2); verify HTTP tests for a viewer, staff invited as a viewer, and an editor
- [x] 1.3 Make read-ticket connections read-only in the collaboration server and document it in `collaboration-websocket.md`; verify a server test that a viewer receives an editor's text while the viewer's own edit is neither applied nor broadcast, and the viewer stays connected

## 2. Viewers in the web app

- [x] 2.1 Add the invite permission choice, viewer notes in the participant list, and the read-only viewer state (design D3); verify component tests

## 3. Posting

- [x] 3.1 Add `codeBlock` and `postBody` (design D4); verify unit tests for fence length, language labels, and the note join
- [x] 3.2 Add `PostToDiscussion` for code and the board, and the gating rules (design D4, D5); verify component tests for destinations by role, the followup body, appending to an existing staff answer with a retry on 412, creating a staff answer, the board attachment upload, and hiding on notes
- [x] 3.3 Browser test against the running stack: a viewer follows an editor's typing and cannot edit; the editor posts the code as a followup and the post shows it; capture screenshots

## 4. Checks

- [x] 4.1 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
  - Local run on Windows, 2026-10-20: format, lint, typecheck, build, and the collaboration API, session component, and live-session browser suites pass (the four live specs passed three runs in a row; one earlier run failed once on a cold dev server). Full-suite environment-only failures are as recorded in `add-session-limits`.
- [ ] 4.2 Archive after the changes this one is stacked on are archived
