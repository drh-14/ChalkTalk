## 1. Contract and failing tests

- [x] 1.1 Extend the affected API/database references (`documentation/api/posts.md`, group endpoints, `documentation/openapi.yaml`, `documentation/database.md`, and dependent API references) with exclusive audience fields, legacy `private` compatibility, group lifecycle, status/headers, and hidden-resource behavior; verify OpenAPI parses and the references agree.
- [x] 1.2 Write public HTTP and isolated-PostgreSQL tests from those references for group CRUD/membership, selected-staff/group post creation and validation, legacy row/request mapping, current access, one-way publish, revision errors, authentication/CSRF, and deletion; run them first and confirm the expected failures.
- [x] 1.3 Write failing seam tests for post/search/cursor/count, answers, followups/replies, upvotes/following, attachment metadata/download, notifications, digest, and live-session invitation/replay/egress after membership or role revocation; verify each fails for the missing audience enforcement rather than setup.
- [x] 1.4 Write failing web component and mocked-API browser tests for all composer audience modes, group management, privacy notices, membership-race rejection, and unselected-reader denial; verify failure and define desktop/mobile screenshots for every tested visible scenario.

## 2. Storage and server authorization

- [x] 2.1 Create the next unused transactional migration (planned `044`) for audience/group/recipient relations, constraints, indexes, and deterministic existing-row backfill; verify migration and database constraint tests in isolated PostgreSQL.
- [x] 2.2 Implement staff-only course group CRUD and membership APIs, including current-course-member validation, no staff read override, name uniqueness, referenced-group delete rejection, and course/account cleanup; verify the group HTTP and database tests pass.
- [x] 2.3 Add the shared current-audience predicate/assertion and update create/get/list/update/publish/delete, duplicate, and idempotency paths; verify the public post contract and negative-visibility tests pass.
- [x] 2.4 Apply the same parent authorization to answers, followups, replies, votes, follows, attachments, search/related results, notifications, and digest while preserving existing private-post exclusions; verify the dependent HTTP/job tests pass.
- [x] 2.5 Enforce current parent access for live-session discovery, invitation, join, replay, every inbound message, and every outbound frame, failing closed on authorization error/deadline/buffer exhaustion; verify connected-session revocation and transport regression tests pass.

## 3. Web and documentation

- [x] 3.1 Implement the four-mode question/note audience picker and staff/group selectors, preserve legacy notice and publish behavior, and surface server-side membership-race errors without changing audience silently; verify component tests pass.
- [x] 3.2 Implement staff group management and accurate feed/detail audience labels and controls, with accessible keyboard/focus/error behavior; verify component tests pass.
- [x] 3.3 Run real-browser tests against mocked API for each affected user-visible flow, capture and attach desktop/mobile screenshots to the draft PR, and verify no visibility leak in the browser scenarios.

## 4. Integration and delivery

- [x] 4.1 Run OpenSpec strict validation, relevant unit and PostgreSQL integration suites, lint/typecheck/build, and full affected browser suite; verify all pass on the final feature head.
- [x] 4.2 Archive the OpenSpec change after verification, squash the scoped work into one commit, run the no-mistakes gate, publish a draft PR, and verify its final head has one commit and passing checks; report any blocked gate or browser/screenshot requirement before publication.
