# Tasks

## 1. Schema

- [x] 1.1 Add migration `027_followup_resolution.sql` (design D1) and document the columns, checks, and index in `database.md`; verify schema tests that a reply cannot be resolved and both columns change together

## 2. API

- [x] 2.1 `setResolved` and the `PUT`/`DELETE /api/v1/followups/{followupId}/resolution` routes, plus `resolved` and `canResolve` on followup projections (design D2); verify HTTP tests for staff, the question's author, a classmate (`403`), a reply (`422 not_a_discussion`), a deleted followup, a private post (`404`), an archived course (`409`), CSRF, idempotency, and unchanged `version` and `lastActivityAt`
- [x] 2.2 Reopen on reply at any depth (design D3); verify HTTP tests for a direct reply and a nested reply
- [x] 2.3 `unresolvedFollowups` on question projections and the `unresolvedFollowups=true` list filter (design D4); verify HTTP tests for the count (deleted roots excluded), the filter, invalid values, and private-post visibility
- [x] 2.4 Update `documentation/api/answers.md` (followups), `posts.md`, and `openapi.yaml`; verify the YAML parses and references resolve

## 3. Web

- [x] 3.1 Followup client `setFollowupResolved`; verify a client test
- [x] 3.2 The Resolved/Unresolved control and the read-only label on root followups, with the post's count updated after a change (design D5); verify component tests
- [x] 3.3 The feed "N unresolved" badge and the staff **Unresolved** filter; verify component tests

## 4. Checks

- [x] 4.1 Browser test against the running stack: a student posts a followup; a TA finds the question under **Unresolved**, resolves the discussion, and the question leaves the filter; the student replies, and the discussion shows **Unresolved** again. Capture screenshots
- [x] 4.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
- [ ] 4.3 Archive after merge
