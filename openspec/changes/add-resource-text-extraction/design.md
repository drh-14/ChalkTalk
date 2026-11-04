# Design

## Context

See proposal.md for motivation and specs/resource-text-search/spec.md for the behavior contract.

Current state that shapes the approach:

- **Catalog files.** Catalog resources (`course_resources` → `active_revision_id` → `course_resource_revisions.file_id` → `course_files`) point at immutable files. Replacing a file creates a new `course_files` row plus a new revision and retires the old file through a deduplicated `delete_course_file` job. Course deletion hard-deletes `courses`, and `course_files` cascades with it.
- **Validation.** Uploads are already structurally validated in `apps/api/src/course-files/validate.ts`, which shells out to `qpdf` for PDFs and uses `fflate`/`saxes` for DOCX/PPTX and `sharp` for images. The same libraries can read those formats again during extraction.
- **Worker.** The worker (`apps/api/src/jobs/worker.ts`) is a single sequential loop. `claim()` uses a hard-coded kind allowlist and a 1-minute lease (5 minutes for `index_post`), with retries backing off exponentially up to `max_attempts`. Today every job is short. OCR of a large scan can take minutes, which would starve email and notification jobs.
- **Post search.** Post search uses `to_tsvector('english', …)`, `websearch_to_tsquery('english', …)` and `pg_trgm` `strict_word_similarity` (`apps/api/src/posts/service.ts`).
- **Catalog listing.** The catalog list uses opaque base64url JSON offset cursors bound to course, sort, section, catalog version and access level, and filters visibility in SQL with the `visible` predicate.
- **Images.** Dev (`Dockerfile.dev`) and deployment (`deployment/Dockerfile`) images are `node:22-bookworm-slim`. CI installs `qpdf` with apt on Ubuntu runners.

## Goals / Non-Goals

**Goals:**

- Run extraction in the existing worker process without delaying other job kinds.
- Ensure stale or hidden text can never be returned. Correctness comes from SQL joins on current state, not from cleanup timing.
- Keep searches bounded in cost per request, and keep extraction bounded in time, memory and disk per file.

**Non-Goals:**

- Instructor-defined regions, page-level deep links, and linking resources from posts. The deferred `/resources/{id}/regions` contracts stay deferred.
- Mixing resources into post search or the related-questions panel.
- Semantic or vector search over resource text, and AI or cloud OCR.
- OCR of images embedded in DOCX/PPTX, OCR of handwriting or math beyond what Tesseract does, and languages other than the configured Tesseract packs.
- Manual re-extraction controls. Re-extraction happens only by replacing the file.

## Decisions

### 1. Store text per immutable file, not per resource

New table `course_file_texts`, keyed by immutable file. Its columns, same-course foreign key, generated search vector and publication constraints are owned by the [database reference](../../../documentation/database.md#course_file_texts-resource-text-extraction); migration `056_resource_file_texts.sql` defines the schema.

Files are immutable, so a file's text never goes stale. Replacing a file makes a new file, which gets a new row. Search joins through `course_resources.active_revision_id` and `deleted_at IS NULL`, so a replaced or removed resource's old text stops matching in the same transaction, with no separate invalidation step.

- _Alternative: a column on `course_resources`._ Rejected. It would need explicit clearing on replacement, and it would race with in-flight jobs writing text for the old file.

### 2. Queue in the catalog transaction, with a pending row and a deduplicated job

In `CourseResourceService`'s upload/replace callback (the same transaction that inserts the revision), insert the `course_file_texts` row with status `pending` and an `extract_file_text` job with payload `{ fileId }`. The job is deduplicated with `deduplication_key = file:<fileId>` and `ON CONFLICT DO NOTHING`.

Migration `056_resource_file_texts.sql` does the same in bulk for every file that is the active revision of a live resource. It inserts into the `jobs` table directly, as earlier migrations do.

The worker writes results with a conditional `UPDATE … WHERE file_id=$1 AND status='pending'`. Every ready, failed or unsupported publication locks the job and checks its owner, attempt and unexpired lease in the same transaction; a lease that expires while publication waits rolls back the result. Text-size reduction retries use savepoints within that transaction. A completed or concurrently cleaned-up row is therefore never overwritten, and a deleted row makes the update a no-op. Catalog reads compute `textStatus` from a `LEFT JOIN`. A missing row is reported as `pending` (the shape is defensive, but migrated data should always have a row).

### 3. A dedicated extraction lane with a heartbeat lease

`claim()` gets a lane parameter:

- The existing general loop excludes `extract_file_text`.
- A second loop in the same worker process claims only `extract_file_text`, one job at a time.

Both loops reuse `runOnce`/`runner.ts`, so emails and notifications are never queued behind OCR.

Extraction jobs take a 2-minute lease. A heartbeat extends `locked_until` every 30 seconds while the job runs, checking `locked_by` and `attempts` the way `succeed()`/`fail()` do. A worker shutdown aborts the running attempt and requeues the job without using up the attempt.

Each job gets 3 attempts (`max_attempts=3`, set by both the upload path and the migration backfill). Every attempt has a hard 15-minute wall-clock limit covering download and extraction. Reaching it aborts the attempt; the download-outage exception below preserves attempts when the store stops responding:

- Attempts before the final one have no OCR time limit, so a slow scan gets the full 15 minutes and then retries.
- Only the final attempt has a 12-minute soft OCR deadline. When it is reached, OCR stops, finished pages are kept, and the result is stored as `ready` with `truncated=true`. The cutoff is a last resort, so a scan is never cut short while a retry could still finish it.
- Lease loss leaves the text pending and the job reclaimable. Other final-attempt failures update the job and text to failed in one transaction, only after the ownership-guarded job update succeeds; a former owner cannot mark the text failed.
- An unreachable object store says nothing about the file, and the exponential backoff would spend all 3 attempts in about 6 seconds. A connection-level error or a 5xx response while fetching the object, or a failure reading its body, therefore requeues the job after 60 seconds without using an attempt, and the text stays pending. A 404 or 403 is an answer about this object and counts as a normal failed attempt, as does a scratch-disk write error during the download.

A request or body stream that stalls until the hard job deadline is also an object-store outage. Abort the source stream along with the download, and preserve the outage classification across the lease wrapper's timeout handling. Shutdown and lease loss take precedence over outage classification; timeouts after a completed download remain normal extraction failures.

Files that cannot be processed fail immediately as permanent failures, without using up retries:

- encrypted or unreadable PDFs;
- corrupt archives and undecodable images;
- `pdftotext` or `pdfinfo` reporting an error on a structurally invalid file.

Everything else is transient and uses the attempts above, because it says nothing about the file: a tool killed by a signal, a non-zero exit from `pdftoppm` or `tesseract` (which only read validated input or images the worker prepared), and scratch-disk write errors. Each rendered page image is deleted right after its OCR, so scratch disk stays bounded to one page per job.

- _Alternative: a separate OCR worker service._ Rejected for now. It adds a deployment unit and compose wiring for one job kind, and the lane split gives the same isolation. The lane can be moved into its own process later, because its claim filter is independent.

### 4. Extraction toolchain: Poppler + Tesseract CLIs, existing npm libraries for the rest

| Media type    | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF           | Run `pdftotext -enc UTF-8` per page range, splitting on form feeds. A page has usable text if it has at least 20 non-whitespace characters. For other pages, up to `RESOURCE_OCR_MAX_PAGES`, read each page's crop box size and render that box with `pdftoppm -cropbox -gray -png` at the possibly fractional DPI `min(300, 0.99999 * 4000 * 72 / longest side in points)`, where the margin covers the six significant digits `pdfinfo` prints, then run `tesseract <png> stdout -l $RESOURCE_OCR_LANGUAGES --psm 3`. |
| PNG/JPEG/WebP | Use `sharp` to apply EXIF rotation, convert to grayscale, downscale to fit 6000x6000 (36 MP), and write PNG. Then run `tesseract`. Upload validation already enforces the 50 MP input limit. Normalizing through sharp avoids depending on Leptonica's WebP support.                                                                                                                                                                                                                                                    |
| Text/Markdown | Decode with `TextDecoder('utf-8', { fatal: false })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DOCX          | Use `fflate` to unzip `word/document.xml`, then a `saxes` stream that collects `w:t` text and puts breaks at `w:p`/`w:br`/`w:tab`.                                                                                                                                                                                                                                                                                                                                                                                      |
| PPTX          | Read `ppt/slides/slideN.xml` and then `ppt/notesSlides/notesSlideN.xml` in numeric order, collecting `a:t` text with breaks at paragraphs.                                                                                                                                                                                                                                                                                                                                                                              |

Office extraction skips individual XML parts whose declared uncompressed size exceeds 64 MiB. Skipped PPTX slides or speaker notes mark the retained text as truncated, even when no wanted parts remain; oversized unrelated archive entries do not. A missing or skipped DOCX body remains a permanent damaged-file failure.

Every tool runs with `spawn` (no shell), a per-invocation timeout of 60 seconds with `SIGKILL`, capped stdout, and a temp directory per job under `os.tmpdir()` that is removed in `finally`. The object is streamed from S3 into that directory.

Text normalization follows the [stored-text contract](../../../documentation/database.md#course_file_texts-resource-text-extraction), implemented by `apps/api/src/resource-text/normalize.ts`. Removing snippet sentinels and search stand-ins from source text keeps Decision 5's substitutions unambiguous.

The 500,000-character cap keeps `to_tsvector` under PostgreSQL's 1 MB tsvector lexeme limit for normal prose, but not for dense unique multibyte tokens (for example, 500,000 characters of distinct two-character CJK words). The result writer therefore catches `program_limit_exceeded` (`54000`) from the generated column, keeps the first 75% of the text, sets `truncated`, and retries until it fits. An integration test stores exactly that worst case.

- _Alternative: tesseract.js + pdfjs-dist._ Rejected. In-process WASM is slower, uses the worker's memory, and still needs a PDF rasterizer. The Poppler and Tesseract Debian packages are mature and match how `qpdf` is already used.

### 5. Search query and snippets

The service validates `q`, normalizes it (trims it and collapses whitespace) and builds `websearch_to_tsquery('english', q)`. The SQL then:

- uses the existing `select` and `visible` predicates with a `LEFT JOIN course_file_texts t ON t.file_id = v.file_id`, so `textStatus` is the same as in catalog reads;
- first selects the course's files with `search_vector @@ q` in a materialized CTE that can use the GIN index, and joins that set in, so only hits read their stored vectors;
- matches `to_tsvector('english', r.title) @@ q OR` a text hit `OR` a title fuzzy clause that mirrors posts: skipped for operator queries (quotes, `OR`, `-`), stop words dropped, and `strict_word_similarity` ≥ 0.5 required for every remaining query term of at least 3 characters;
- orders by `in_title DESC`, then `(ts_rank_cd(title)*2 + ts_rank_cd(t.search_vector) + fuzzy) DESC`, then `r.id`;
- uses `LIMIT/OFFSET` with an opaque cursor `["resource-search:v1", courseId, normalizedQ, access, offset]`, validated like the catalog cursor.

Fuzzy title similarity is evaluated over the course's visible resources; it does not use a title trigram index.

Snippets are computed only for the returned page, in a second query using `ts_headline`; `CourseResourceService.search` owns the SQL and headline options. Node converts the sentinels into ranges and trims the text with `toSnippet`, following the [ResourceSearchResult schema](../../../documentation/openapi.yaml#/components/schemas/ResourceSearchResult). The browser renders the ranges as `<mark>` around text nodes, never as HTML.

PostgreSQL's default parser treats `<...>` sequences as HTML tags: it neither indexes their contents nor returns them from `ts_headline`. Both the generated `search_vector` and the headline input therefore use `translate(text, '<>', U&'\E000\E001')`, a one-to-one swap that keeps offsets stable. Normalization removes U+E000/U+E001 from source text, and `toSnippet` maps them back, so markup-like text is both searchable and returned verbatim as plain text.

- _Alternative: return `ts_headline` HTML._ Rejected because of injection risk and because the API returns plain data.

### 6. The search route is separate from catalog listing

The new route is `GET /courses/:courseId/resources/search`. It is registered before `/resources/:resourceId` so `search` is not taken for an ID. It keeps the existing catalog list contract, ETag and cursor untouched apart from the additive `textStatus`.

### 7. Configuration and tool availability

- **Settings.** `RESOURCE_OCR_MAX_PAGES` (integer 0–2000, default 200; caps OCR'd PDF pages per file, so 0 keeps PDF text layers only, while images are always OCR'd) and `RESOURCE_OCR_LANGUAGES` (default `eng`, validated as `+`-joined `[a-z_]{3,}` codes) are parsed in the API config module.
- **Startup probe.** At startup, the worker runs `pdfinfo -v`, `pdftotext -v`, `pdftoppm -v` and `tesseract --list-langs`, whatever `RESOURCE_OCR_MAX_PAGES` is. If a tool or a configured language is missing, the extraction lane logs a structured error and does not start. Jobs stay `pending`, so a corrected deployment processes them, rather than burning retries into `failed`.
- **Images and CI.** `Dockerfile.dev`, `deployment/Dockerfile` (app stage) and the CI apt step install `tesseract-ocr tesseract-ocr-eng poppler-utils`.

### 8. Cleanup

The `delete_course_file` handler deletes the `course_file_texts` row for that file, by `object_key`, after confirming the file is unreferenced. Course deletion is covered by the FK cascade. Search correctness never depends on this cleanup (see Decision 1).

## Risks / Trade-offs

- **Malicious or pathological files hitting Poppler/Tesseract.** Mitigations:
  - Uploads are already qpdf-validated.
  - Tools run without a shell, with timeouts, render-size and pixel caps, a page cap, and a per-job temp directory.
  - Extraction runs in the background worker, separate from application request handling.
  - The images use distro security updates.
- **OCR quality.** Tesseract is weak on handwriting, math and low-resolution scans, so some content won't be findable. This is accepted, because title search still works and the staff indicator surfaces failures. Normal pages render at 300 DPI; only pages too large for the 4,000-pixel cap render lower.
- **Large backfill on first deploy.** OCR jobs run one at a time in their own lane. A course with many scanned PDFs may take hours to become fully searchable, but other jobs are not delayed. `RESOURCE_OCR_MAX_PAGES` bounds the work per file.
- **`ts_headline` cost on long texts.** It runs only for at most 50 returned rows, and each text is capped at 500k characters. If profiling shows a hotspot, a later change can store per-page text and headline only the best-matching page.
- **Differences between OCR engine versions.** CI (Ubuntu) and the images (Debian) ship different Tesseract builds. Tests assert that distinctive words are present, never exact OCR output.
- **Integration with merged PR #116.** Preserve its frozen email payloads, cancellation outcomes, permanent provider failures, and 15-minute configuration/quota retry delay alongside the extraction lane. The shared failure update retains email snapshot cleanup and OCR's ownership-guarded transaction; only an owned final extraction failure publishes failed text. Migrations 053 and 054 precede this change's 056. Existing email and extraction integration tests validate both contracts after rebasing; PR #114's collaboration finalization tests remain unchanged.

## Migration Plan

1. Deploy images that include the OS packages. The migration creates the table, indexes and backfill rows and jobs.
2. The worker's extraction lane drains the backfill. Search works immediately on titles and progressively on text as extraction completes.
3. Rollback: revert the application. The `course_file_texts` table and any leftover `extract_file_text` jobs are inert, because older workers never claim that kind and the table can be dropped by a follow-up migration. Uploads are unaffected because extraction never gates them.

## Open Questions

- Is the default `RESOURCE_OCR_MAX_PAGES` of 200 right for real course scans? This can be tuned per deployment without spec changes.
