## 1. Contract and red tests

- [x] 1.1 Update the proposed history route/response contract in `documentation/api/posts.md`, `documentation/api/answers.md`, `documentation/openapi.yaml`, and `documentation/database.md`; verify examples and schemas agree on authorization, ETag, errors, anonymity, and lifecycle.
- [x] 1.2 Write failing PostgreSQL migration tests for baseline snapshots, merged-source retention, deleted/tombstone exclusion, idempotence, and current-text parity; run focused tests and confirm expected failure before migration code.
- [x] 1.3 Write failing API integration tests from the references for create/edit/no-op/metadata capture, list/get/compare, private and cross-course visibility, anonymous/deleted editor projection, deletion purge, archived/merged lifecycle, conditional staff restore, validation, and rollback; run focused tests and confirm expected failure.
- [x] 1.4 Write failing UI/client tests for post, answer, root-followup, and reply history/compare, anonymous redaction, staff restore, and stale restore feedback; run focused tests and confirm expected failure.

## 2. Persistence and service behavior

- [x] 2.1 Check upstream migration numbering, reserve `047` only if still free, and add revision storage/backfill plus indexes/constraints; verify migration tests and existing schema checks pass.
- [x] 2.2 Add atomic revision capture to post, answer, and followup create/text-save paths, preserving version and existing endorsement/activity semantics; verify focused API tests pass and no-op/nontext operations add no revision.
- [x] 2.3 Add same-transaction revision purge to individual content deletion and course deletion worker; verify deletion/tombstone/worker retry tests show no accessible or stored historical text afterward.
- [x] 2.4 Implement shared current-parent visibility and identity-safe history reads for each content kind; verify private, merged, archived, cross-course, and anonymous API tests pass with no-store headers.
- [x] 2.5 Implement staff-only conditional text restore using existing validation and save rules; verify stale/failed requests do not mutate content or history, while successful restore creates a new snapshot and preserves nontext fields.

## 3. Interface and delivery

- [x] 3.1 Add typed clients and accessible history/compare/restore views in existing post and answer/followup UI, with explicit 412 recovery; verify UI/client tests pass.
- [x] 3.2 Run real-browser tests with mocked API for reader compare, anonymous identity protection, staff restore success/conflict, and hidden/archived states; capture and attach one screenshot per user-visible scenario to the draft PR, and verify screenshots visually.
- [x] 3.3 Run full relevant repository tests, lint/typecheck, migration checks, and `openspec validate all-content-revision-history --strict`; record results and fix failures.
- [x] 3.4 Sync the validated revision-history delta into the main spec and archive the verified OpenSpec change.
- [x] 3.5 Squash the scoped implementation to one commit, run the no-mistakes gate, publish one draft PR, attach screenshots, and verify final-head checks and exactly one PR commit.
