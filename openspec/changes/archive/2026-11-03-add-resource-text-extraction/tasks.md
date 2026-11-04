# Tasks

## 1. Toolchain and configuration

- [x] 1.1 Add `tesseract-ocr tesseract-ocr-eng poppler-utils` to `Dockerfile.dev`, the `deployment/Dockerfile` app stage, and the CI apt step in `.github/workflows/ci.yml` (design D7). Verify that `docker compose build worker` succeeds and that `tesseract --list-langs` and `pdftotext -v` run inside the worker container
- [x] 1.2 Parse and validate `RESOURCE_OCR_MAX_PAGES` (0–2000, default 200) and `RESOURCE_OCR_LANGUAGES` (default `eng`) in the API config module, add them to `.env.example`, `deployment/.env.example` and the README environment section. Verify config unit tests for the defaults, the bounds, and rejection of malformed language lists

## 2. Schema, queueing and catalog status

- [x] 2.1 Write migration `056_resource_file_texts.sql` (design D1, D2): the `course_file_texts` table with a generated `search_vector` and its GIN index, and pending rows plus deduplicated `extract_file_text` jobs for every live active-revision catalog file. Document the table in `documentation/database.md`. Verify with a migration integration test that seeds live, removed, replaced and link resources plus a syllabus file, and asserts exactly one pending row and job per live catalog file, and none for anything else
- [x] 2.2 Insert the pending row and deduplicated job inside the catalog upload and replace transactions in `CourseResourceService`. Verify HTTP integration tests that a create or replace queues exactly one job for the new file, that an idempotent replay queues nothing, and that a failed upload leaves no row or job
- [x] 2.3 Add the `textStatus` projection to upload entries in catalog list and read responses (a `LEFT JOIN`, with a missing row reported as `pending`), and update `documentation/api/resources.md` and `documentation/openapi.yaml`. Verify HTTP tests for each status value, that link entries have no field, and that catalog ETag and cursor behavior is unchanged

## 3. Extractors

- [x] 3.1 Create the `apps/api/src/resource-text/` module with a sandboxed `spawn` runner (timeout, `SIGKILL`, stdout cap, per-job temp directory cleanup) and text normalization (design D4). Verify unit tests for timeout kill, temp directory removal after a throw, normalization, and the worst-case tsvector size input against PostgreSQL
- [x] 3.2 Add the text/Markdown, DOCX and PPTX extractors (slides then notes, in numeric order). Verify unit tests against small committed fixtures, including a PPTX with notes and a DOCX with tabs and line breaks
- [x] 3.3 Add the PDF extractor (text layer per page, OCR fallback below the usable-text threshold, page cap, and the truncated and OCR-page counts) and the image extractor (sharp normalization, then Tesseract). Verify tool-dependent tests that are skipped with a reason when the binaries are absent, using committed fixtures: a text PDF, an image-only scanned PDF, a mixed PDF, a PDF over the page cap, an encrypted PDF (a permanent failure), and rotated JPEG and WebP images. Assert that distinctive words are present, not exact OCR output

- [x] 3.4 Preserve the 64 MiB per-XML-part extraction bound while reporting skipped PPTX slides and speaker notes as truncated. Verify partial and empty results at `extractText`, numeric ordering and ordinary Office extraction, oversized unrelated entries, unchanged DOCX failures, and storage of the truncation flag (25 focused extraction and storage tests passed; changed-file formatting/lint, API typecheck and strict OpenSpec validation passed)

## 4. Worker lane

- [x] 4.1 Split `claim()` into general and extraction lanes, run the extraction loop alongside the general loop in `jobs/main.ts`, and add the 2-minute lease with a 30-second heartbeat, a 15-minute wall-clock limit and a soft OCR deadline on the final of 3 attempts (design D3). Verify worker integration tests that a long extraction job does not delay a queued email job, that the heartbeat keeps the lease, that an expired lease is reclaimed, that only the final attempt receives the deadline, and that a shutdown requeues the job without using an attempt
- [x] 4.2 Implement the `extract_file_text` handler: stream the object to the temp directory, extract, write the result with a conditional `UPDATE … WHERE status='pending'`, mark permanent failures `failed` immediately, and mark the row `failed` when the final retry fails, and requeue without using an attempt when the object store is unreachable. Verify worker integration tests for ready, failed, permanent-failure and retry-exhaustion outcomes, for object store outages against missing or forbidden objects, and that no result is written when the row was deleted mid-job
- [x] 4.3 Add the startup tool and language probe so that the extraction lane does not start when tools are missing and jobs stay pending. Verify a worker test that stubs a missing binary and asserts the error is logged and no extraction job is claimed
- [x] 4.4 Extend the `delete_course_file` handler to delete the file's `course_file_texts` row. Verify worker integration tests for replacement cleanup and that course deletion cascades
- [x] 4.5 Preserve pending text without consuming an attempt when an object request or body stream stalls until the hard deadline, including the final attempt. Verify stalled downloads, shutdown and lease-loss precedence, scratch-write errors, and normal extraction timeouts with focused tests (60 focused worker and download tests passed)

## 5. Search API

- [x] 5.1 Implement `CourseResourceService.search` (design D5): validation and normalization, the visibility predicate before ranking, title, text and fuzzy-title matching, ranking with title matches first, cursor encoding and validation, and page-scoped plain-text snippets with UTF-16 highlight ranges. Verify service integration tests for every scenario in the spec's search, visibility and lifecycle requirements, including staff-only filtering with equal `hasMore`, removed and replaced resources, former members, archived courses, the misspelled title, a pending file, and HTML-like snippet text
- [x] 5.2 Register `GET /api/v1/courses/:courseId/resources/search` before the `:resourceId` routes, with the strict query-field allowlist, `Cache-Control: private, no-store` and the error mapping. Document it in `documentation/api/resources.md` and `documentation/openapi.yaml`. Verify HTTP tests for 200, 400 (empty, oversized, repeated or unknown fields, `limit` 0 and 51, a foreign cursor), 401, 404 and 503, and that the YAML parses and its references resolve

## 6. Web

- [x] 6.1 Add the search API client and Resources page search field: debounced, labeled, a results view with section name and `<mark>` highlights rendered from ranges, load more, empty and error states that keep the query, and clearing that restores the catalog's sort, section state and open edits. Verify component tests for highlight rendering (including HTML-like text rendered as text), debounce, load more, and restoring the catalog
- [x] 6.2 Add the staff-only indicator for `pending`, `failed` and `unsupported` file entries. Verify component tests that an instructor or TA sees it and a student does not
- [x] 6.3 Add a mocked-API browser test (`tests/browser/resource-text-search.spec.mjs`, with an npm script and a CI step) covering a student content search with highlights, the no-results state, the instructor failed-extraction indicator, the student view without it, a mobile-width results layout, and open edits surviving a search while unreachable by keyboard. Capture a screenshot of each scenario

## 7. Integration and delivery

- [x] 7.0 Verify lease-fenced publication for ready, failed, unsupported and retry-exhausted results, transactional dense-text reduction, and oversized/letter PDF page rendering (56 focused worker, store and failure-handling tests passed)

- [x] 7.1 Full-stack smoke test in the dev Compose stack: upload a text PDF, a scanned PDF and a PNG as an instructor, wait for `textStatus: "ready"`, and confirm a student finds each by a word from its contents. Record the output
- [x] 7.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build. Record any environment-only failures with evidence
- [x] 7.3 Commit on a feature branch, run the no-mistakes gate, address its findings, squash to one commit, and publish a draft PR with the browser screenshots. Verify final-head CI
- [x] 7.5 Rebase over merged PRs #114 and #116, preserving email and OCR failure handling. Run worker/email, extraction/search, and collaboration tests, browser resource-search coverage, repository checks, and a fresh Codex no-mistakes gate. Apply the one-commit publication and final-head CI requirements in task 7.3 to the updated PR #118
- [x] 7.4 Archive after merge

Verification: Codex no-mistakes run `01M6H0RTNA2P59KQZWQN7PB92W` passed review, live browser/API/worker/backfill scenarios, focused automated tests, documentation, lint, and all five CI jobs. Evidence and screenshots are attached to PR #118. The stalled-download outage fix passed 60 focused tests. Windows CRLF-only formatting warnings were normalized or checked with automatic line-ending detection; the OpenAPI archive newline artifact passed when rerun against the actual checkout. OpenSpec remains active until merge.

Integration verification: Codex run `01M6HV1EEMK90VWBF54SZ9SXYV` passed independent review, live extraction/search/recovery, six browser flows, local email-provider compatibility, collaboration finalization, documentation and lint. The earlier run found the oversized PPTX-part completeness bug; its fix passed 25 focused extraction/storage tests. Local checks also passed formatting, lint, typecheck, production build and five Compose tests. The serial suite passed 1,512 tests with 41 environment-dependent skips; its single upload-cleanup failure was an inherited temporary directory in the reused image, and all 31 upload tests passed with a fresh temporary directory. Rebase was performed manually against `main`; publication and GitHub CI are verified separately on the final PR commit.
