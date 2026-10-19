## 1. Persistence and API contract

- [x] 1.1 Add the attachment migration with exactly-one-parent and same-course constraints; verify migration and database constraint tests.
- [x] 1.2 Add failing PostgreSQL HTTP tests for upload, list/projection, private download, idempotency, cap, media rejection, and parent permission/lifecycle for posts, answers, and followups; confirm the expected red failures.
- [x] 1.3 Implement parent-scoped upload/download/removal using the existing file-backed validator and S3 transfer; verify all new HTTP integration tests pass.
- [x] 1.4 Add failing worker tests for attachment removal, parent deletion, duplicate hide/unmerge, course deletion, and answer endorsement history; confirm red, implement cleanup/version handling, and verify green.

## 2. Frontend integration

- [x] 2.1 After final PR #50 reaches main, use its save-only Markdown answer/followup UI to add failing UI tests for selected files, per-file retry, centered image blocks, document links, and hidden attachment states; confirm red. Rebase onto main after the UI prerequisite lands.
- [x] 2.2 Integrate the shared composer and parent views without changing standalone course-file UI; verify UI tests pass.
- [x] 2.3 Run real-browser mocked-API tests for question, note, answer, root followup, reply, upload failure/retry, image display, and document download; capture screenshots for each visible scenario.

## 3. Final verification and delivery

- [x] 3.1 Run focused API/PostgreSQL/S3 tests, frontend tests/build/lint, and OpenSpec strict validation; verify all pass.
- [x] 3.2 Archive the OpenSpec change after implementation; verify main specs reflect attachment behavior.
- [ ] 3.3 Once final save-only UI prerequisite PR #50 is on main, rebase and run no-mistakes, squash to one commit, publish a draft PR, and verify final CI and screenshots.

## Verification checkpoint

- Rebased on actual merged save-only UI commit `e437474`; migration 015 follows 014, with no attachment Yjs/runtime coupling.
- Red/green evidence includes missing upload routes; missing frontend client/queue/view/composer behavior; three deterministic sibling lock-upgrade deadlocks; and delayed post-refresh failure retention.
- Final local full suite: 606 passed, two unrelated SMTP-dependent digest scenarios skipped. The real PostgreSQL/SeaweedFS attachment contracts (22 scenarios), actual authenticated API/worker-process smoke, and separate worker lifecycle checks pass with isolated schema/bucket teardown.
- Ten real Chromium mocked-API attachment scenarios plus the three existing save-only browser regressions pass; screenshots cover images/documents, post/answer/followup/reply creation, retries, explicit overwrite retention, deletion, archived mobile viewing and five-file selection limits.
- Typecheck, lint, formatting, builds and strict OpenSpec validation pass. Existing Vite bundle-size advisory is unchanged.
- Gate completion, one-commit draft publication and final-head CI remain delivery work; no merge is authorized.

Implementation and local verification are archived. The remaining unchecked task is the publication gate/CI delivery step, not unfinished product behavior.
