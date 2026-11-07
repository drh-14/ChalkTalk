# Design

## Context

See proposal.md. Current `ResourceExtractedText` fetches once on expand/cycle. Catalog reload replaces loaded items and search reload clears results/cursors, so either mechanism would lose state if used as a timer. `course_file_texts` holds durable file-owned extraction state; `jobs` has a unique extraction deduplication key `file:<fileId>`, owner, attempt and lease. Existing worker transaction(job) fences publication. The user approved a small additive migration and automatic completion refresh. PR #147 remains the feature base; this is a separate change and PR.

## Goals / Non-Goals

Live truthful OCR work progress, current-file privacy, and in-place completion without disturbing editors. Preserve OCR selection thresholds, caps, truncation, original bytes and stored-text normalization. No ETA, partial-text streaming, searchable-PDF progress changes, new endpoints/dependencies/services, full-stack browser tests or runtime demo writes during implementation verification.

## Decisions

### File-owned durable progress and migration

Add `059_resource_text_progress.sql` (recheck next free number before writing) with nullable `progress_phase`, `progress_completed_pages`, `progress_total_pages`, `progress_attempt` on `course_file_texts`. Allowed stored phases queued/preparing/ocr/saving; all progress columns null on terminal rows. Null phase on existing pending rows projects queued, so no extraction backfill/requeue is needed. Queued has null attempt/counts; preparing/saving require positive attempt and null counts; ocr requires positive attempt, positive total and completed between zero and total. Enforce complete shape via database CHECKs, including paired counts. Keep public `textStatus` enum unchanged. Progress is operational metadata: do not bump catalog versions/ETags or edit original migrations. Alternatives jobs.payload or process memory couple display to private queue state or lose progress on restart; file-owned columns fit existing extraction lifecycle.

At attempt start, persist preparing with the current job attempt, resetting counters. Progress callbacks are awaited after inspection and after each OCR page, not each recognized word. PDF work total is `needsOcr` count across inspected pages before applying the OCR budget; page-budget or character-budget truncation remains authoritative. Count completed OCR operations, not physical page index, including when recognized text loses to exact selectable text. Text-only PDFs and non-PDF formats stay indeterminate preparing then saving. Emit saving immediately before existing ready publication; all terminal paths clear progress in the same fenced transaction as status/text. Queue, retry, shutdown and storage-outage requeue clear progress when practical; projection fallback also prevents stale running displays.

### Fence each update and project only a live attempt

Reuse worker transaction(job) ownership/attempt/unexpired-lease lock for progress writes. Update only pending text for the still-live current upload; stop callbacks on abort/lease loss. Keep the existing course/file deletion locking order and avoid introducing a job-to-course lock inversion: current-revision predicates can be checked without adding a competing lock hierarchy. A stale callback must fail/abort rather than continue claiming progress. Publication already fences job ownership; retain it.

Extend existing resource selection/project helpers and explicit search SELECT projection with nullable public `textProgress:{phase,completedPages,totalPages}`. Join/inspect only extraction job kind+deduplication key. Expose stored running phases only when job is running, attempt equals progress_attempt and lease is unexpired; otherwise pending projects queued. Terminal projects null; links omit the field. Read metadata/status/progress from one authorized consistent snapshot. Do not expose progress_attempt or job IDs. Resource metadata GET remains200 private,no-store with existing401/404/503 behavior; add field consistently to upload list/search/read/mutation envelopes. Existing /text response stays unchanged, avoiding large-text polling. Update documentation/api/resources.md, documentation/openapi.yaml CourseResource, and documentation/database.md alongside code.

### Shared bounded metadata watcher

Add a resource-specific watcher/hook scoped to Resources, shared by cards and expanded panels and keyed courseId/resourceId/fileId. Reuse existing GET resource metadata via a small client function; no generic data-cache dependency. Coalesce identical subscriptions, limit active checks to4 and one in-flight request per key. Poll at2s for30s then10s; stop after16min visible cycle with Check again. Pause on document hidden and restart a fresh bounded cycle when visible. Retry transient errors with a bounded delay (10s, then30s) inside that same deadline; retain last data and recoverable error text, never a fabricated percentage. Stop after terminal,404/401, loss of subscribers, navigation or key change; abort requests and generation-guard all callbacks.

Poll only staff pending-card identities and authorized open pending text panels; students do not start background card watches. Merge only textStatus/textProgress into matching existing catalog and search rows, never invoke page reload cycles, reset snippets/cursors or replace editors. Query switching drops search-specific subscriptions; catalog subscriptions may remain when catalog is merely hidden, but invisible cards need not poll. Resource version changes from same-file edits keep the watcher identity; a different fileId marks the old watcher superseded with a reload notice, no Check again and no visibility restart.

For an expanded pending text panel, initial /text fetch remains; watcher terminal-ready triggers one fresh /text request for the same identity. Progress ticks never fetch full text. Preserve readable/original layout, draft and download URL cleanup. On close/mode change/identity change abort obsolete text work. Searchable PDF uses its existing independent status flow. On authorization loss remove inaccessible data/panel without overwriting unrelated drafts. At terminal failed/unsupported use existing unavailable presentation. Staff pending card uses Queued for extraction, Preparing extraction, OCR completed of total pages with semantic progress element, or Saving extracted text; an open reader panel can show the same feedback. Keep normal Downloads available throughout.

## Risks / Trade-offs

- Attempt takeover or lease expiry makes an old worker look active → attempt/lease projection and fenced writes; test late callbacks and commit races.
- Mixed PDFs or caps give misleading100% → count OCR work only, denominator before cap, indeterminate saving and ready-only completion; retain truncated notice.
- Automatic reload destroys drafts/pagination → status-only identity-checked merges and browser assertions with loaded pages and active drafts.
- Many pending files flood API → deduplication, four-request limit, slower polling, hidden-tab pause and bounded cycles; no full text in polls.
- Existing APIs use common metadata and a separate search SELECT → cover list/read/search/mutation envelopes and snapshot/private headers from API references.

## Migration Plan

Apply additive059 before new API/worker rollout. Restart workers so new attempts report progress; old pending rows remain queued until a live reporting attempt starts. Terminal rows remain unchanged. Before rollout, stop old workers and restart them with the migrated code to avoid mixed-version writes. To roll back, stop new workers, clear all four progress fields on pending rows, then restore old code; terminal CHECK constraints otherwise reject an old worker publishing a pending row with progress. Preserve migration history and do not drop columns or requeue demo files as rollback. Runtime migration/demo deployment belongs to parent after test verification, never the planner.

## Implementation Handoff

Main files: resource-text/pdf.ts/extract.ts/store.ts/queue.ts; jobs/worker.ts; course-resources/service.ts; web course-files/client.ts/views.tsx/extracted-text.tsx/styles.css and new watcher hook. Existing tests: resource-text/failure-handling.test.ts, http/resource-text.integration.test.ts, http/organized-resources.integration.test.ts, jobs/extraction.integration.test.ts, web course-files/search/organized/searchable-pdf tests and browser/resource-extracted-text.spec.mjs/resource-text-search.spec.mjs. Add focused public seam tests from API/OpenAPI/database references first, with disposable database/object storage for backend integration and mocked APIs in real Chromium. Keep root demo checkout unchanged. Branch feat/resource-extraction-progress in .cache/resource-extraction-progress starts at81add96. Draft PR base fix/recoverable-pdf-uploads until147 merges, then retarget main; deliver one scoped commit.
