# Proposal

## Why

Course Resources only match on titles, so students cannot find the lecture slide, handout or scanned worksheet that actually contains a concept. The product design calls for OCR-backed resource text search, but nothing extracts document text today. Whole-document extraction is the foundation the later instructor-defined regions feature will build on, so it comes first.

## What Changes

- Add a background extraction pipeline that produces plain text for every uploaded catalog resource file:
  - PDF: the native text layer per page, with self-hosted Tesseract OCR for pages that have no usable text layer (scans), up to a configurable page cap.
  - PNG, JPEG, WebP: Tesseract OCR.
  - Plain text and Markdown: decoded UTF-8 text.
  - DOCX and PPTX: text from the document XML (embedded images are not OCR'd).
- Queue extraction when a catalog file is uploaded or replaced, and backfill every existing live catalog file once at migration time.
- Track a per-file extraction status (`pending`, `ready`, `failed`, `unsupported`) and expose it as an additive `textStatus` field on upload entries in the catalog list.
- Add `GET /api/v1/courses/{courseId}/resources/search?q=` returning visible catalog resources ranked by title and extracted-text matches, each with a plain-text snippet and highlight ranges. Links match on title only and are never fetched.
- Apply the existing catalog visibility rules (staff-only sections and items, current membership, archived reads) before ranking and pagination.
- Hide extracted text immediately when its resource is removed or its file replaced, and delete the text when the worker cleans up the file.
- Add a search box to the Resources page. It shows ranked results with snippets in place of the catalog while a query is active, and shows staff a badge on files whose text is pending, failed or unsupported.
- Install Tesseract (English) and Poppler utilities in the development and deployment images. No AI or external service is involved, so this works in the default no-AI mode.

## Capabilities

### New Capabilities

- `resource-text-search`: Extract text from uploaded catalog resource files (native text and Tesseract OCR), track extraction status and lifecycle, and search visible course resources by title and extracted text.

### Modified Capabilities

<!-- None. The catalog list gains an additive textStatus field, specified in resource-text-search; existing organized-course-resources requirements are unchanged. -->

## Impact

- **Database:** new migration `056_resource_file_texts.sql` with a `course_file_texts` table (status, text, generated `tsvector`, a GIN search index) and backfill jobs for existing catalog files.
- **API:** `apps/api/src/course-resources/service.ts` (queue extraction in upload/replace transactions, `textStatus` projection, new search query), `apps/api/src/http/app.ts` (search route), and a new `apps/api/src/resource-text/` extractor module.
- **Worker:** `apps/api/src/jobs/worker.ts` handles a new `extract_file_text` job kind, and the `delete_course_file` job also removes the extracted text.
- **Web:** `apps/web/src/course-files/views.tsx` gets the search box, results view and staff status badge.
- **Dependencies:** OS packages `tesseract-ocr`, `tesseract-ocr-eng` and `poppler-utils` in `Dockerfile.dev` and `deployment/Dockerfile`. No new npm runtime packages: `sharp`, `fflate` and `saxes` are already present.
- **Configuration:** `RESOURCE_OCR_MAX_PAGES` (default 200) and `RESOURCE_OCR_LANGUAGES` (default `eng`).
- **Docs:** `documentation/api/resources.md`, `documentation/openapi.yaml`, `documentation/database.md` and the README's environment section.
- **Coordination:** PR #116 (which replaced closed PR #115) merged the Resend worker changes and migrations 053 and 054 into `main`. Rebase this change over it, preserving frozen email payloads, cancellation, provider-error handling, and OCR lease-fenced retries. Migration 056 does not collide. Also retain PR #114's deterministic collaboration finalization tests.
