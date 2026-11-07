# Tasks

## 1. Durable extraction progress

- [x] 1.1 Derive migration/store/worker regressions from the delta spec and database reference before implementation: legacy pending/terminal rows, legal phase/count shapes, invalid count/nullness, mixed PDF OCR denominator, cap/deadline truncation, active attempt, stale callback, expired lease and retry reset; demonstrate the new cases fail before code/migration.
- [x] 1.2 Add additive next-number migration059 and file-owned progress storage/reset helpers; document fields and constraints in documentation/database.md; verify constraint tests and existing migration/publication tests in a disposable database, without changing the demo DB.
- [x] 1.3 Add awaited preparation/OCR-page/saving callbacks and job-fenced writes/reset/terminal cleanup while preserving existing OCR selection, rendering limits and status policy; verify PDF, failure-handling and extraction integration cases including no-OCR PDFs/non-PDF indeterminate states, missing tools, object-store outage, shutdown, retries and late writes.

## 2. Authorized metadata contract

- [x] 2.1 Write public API tests from documentation/api/resources.md, documentation/openapi.yaml and database.md before implementation: list/read/search/mutation envelope parity, queued/ocr/terminal shape, private no-store headers, existing401/404/503 rules, archived courses, staff-only visibility, current revision, replacement/deletion and stale job masking; demonstrate missing fields/fencing behavior fails first.
- [x] 2.2 Extend shared and search-specific upload metadata projections with textProgress and live-attempt checks, retaining existing /text shape and resource ETags/versions; update API/OpenAPI references and verify new tests plus existing resource API/lifecycle suites pass with actual PostgreSQL and disposable object storage where required.

## 3. Automatic UI updates without page resets

- [x] 3.1 Add specification-first component and mocked-API real Chromium coverage for queued/preparing/7-of18 OCR/saving/ready, student card notice absence, authorized panel progress, pending-to-readable text and .txt download, draft/files/sort retention, loaded catalog/search pages and snippets, retry/hidden tab/16-minute Check again, coalesced requests, stale replacement/close/navigation and authorization loss; capture each user-visible scenario and demonstrate relevant cases fail first.
- [x] 3.2 Implement a course-scoped shared pending-metadata watcher with identity guards, coalescing, max4 concurrent requests,2s->10s cadence, hidden-tab pause, bounded retries and16-minute visible cycles; merge only extraction status/progress into matching loaded entries. Verify component/network assertions and real-browser draft/pagination/search scenarios pass without whole-page reload calls.
- [x] 3.3 Replace staff generic pending notice with phase labels and accessible OCR work-page progress; connect expanded pending text to the same watcher and one ready-triggered full-text fetch, preserving layout/downloads and cancellation. Keep searchable-PDF processing separate. Verify desktop/mobile, ready/empty/truncated/failure and stop/resume scenarios pass; inspect committed screenshots and update product/API prose to match.

## 4. Integration and delivery

- [x] 4.1 Run focused backend/component/Chromium suites, format/lint/typecheck/build and strict OpenSpec validation on the integrated tree; record actual results and skipped coverage, and verify no runtime demo database changes were made by checks.
- [x] 4.2 Deploy migration059 without resetting, seeding or requeuing existing data. Confirm healthy services and authenticated progress metadata; the existing upload remains ready. No pending demo upload was available; pending-to-ready coverage uses disposable backend and mocked browser tests. Record this limitation in verification notes and handoff.
- [x] 4.3 Run no-mistakes with explicit mocked-API browser constraint, resolve findings and accurately report any blocked/skipped phase; archive/sync completed OpenSpec artifacts. Verify final source tree and preserve all gate fixes before publication.
- [x] 4.4 Publish a separate draft PR with exactly one scoped commit, screenshots and verification notes; base it on fix/recoverable-pdf-uploads while147 is unmerged and retarget main after147 merges. Use an explicit force-with-lease for squash updates and verify final-head CI, draft status and commit count; leave147 unchanged.

Delivery evidence: draft PR156 contains one scoped commit; all five CI jobs passed on ea63d3590d20a6ee6fa10806779bce38dc7c35cd in run42116324895. Final archive amendment changes only specifications and delivery records; repeat final-head CI verification after its lease-protected push. The repository copy of its verification notes and screenshots was removed during screenshot cleanup.
