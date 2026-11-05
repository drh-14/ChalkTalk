# resource-searchable-pdfs Specification

## Purpose

Let course members view and download a separate searchable copy of an uploaded PDF, generated in the background with an aligned invisible OCR text layer, while the original file stays unchanged.

## Requirements

### Requirement: Prepare a separate searchable PDF copy

For an accessible current PDF upload in an active or archived course, an authenticated member SHALL be able to request a separate searchable copy using POST `/api/v1/courses/{courseId}/resources/{resourceId}/searchable-pdf` with an empty JSON object, allowed Origin and valid session CSRF token. The operation SHALL return 202 while generation is pending and 200 when an existing ready copy is reused, with private no-store caching, a status Location and `{data:{fileId,status,pageCount,sizeBytes,viewUrl,downloadUrl}}`. Status SHALL be not_requested, pending, ready or failed; page count, size and URLs SHALL be null unless ready. Concurrent requests SHALL enqueue only one current generation. A failed copy MAY be retried as a fresh generation. Preparing a copy SHALL NOT rewrite original bytes, alter existing extracted search text, change resource identity/version or block access to an already ready text extraction.

#### Scenario: First preparation and concurrent retry

- **WHEN** authorized readers concurrently request a searchable copy of the same current PDF
- **THEN** one pending generation and background job exist, and all requests return the current file ID and pending state

#### Scenario: Reuse and explicit failed retry

- **WHEN** a reader requests an already ready copy or retries a failed copy
- **THEN** ready bytes are reused without another job, or one fresh fenced generation is queued for the failed copy

### Requirement: Read only an authorized current copy

GET `/api/v1/courses/{courseId}/resources/{resourceId}/searchable-pdf` SHALL return status without starting generation. GET the corresponding `.../searchable-pdf/{fileId}/view` and `.../download` routes SHALL stream only ready output bound to the currently active upload revision. Success SHALL use application/pdf, exact length, safe inline or attachment disposition respectively, nosniff and private no-store caching. Downloads SHALL use a safe `-searchable.pdf` filename. Every route SHALL enforce current membership, active/archived course state and existing item/section visibility. Missing session SHALL return 401; invalid unsafe Origin/CSRF SHALL return 403; missing, inaccessible, hidden, removed, wrong-course, non-PDF or link resources and stale file IDs SHALL return 404; content requested before ready SHALL return 409 searchable_pdf_not_ready; unavailable service/storage SHALL return 503. No internal object keys, failure codes or public/presigned storage URLs SHALL be returned.

#### Scenario: Ready inline view and download

- **WHEN** an authorized current member opens or downloads a ready searchable PDF
- **THEN** the same derived bytes and safe headers are returned, with inline or attachment disposition as requested

#### Scenario: Visibility or revision changes

- **WHEN** membership is revoked, the resource/section becomes staff-only, the resource is removed, the course starts deleting or its file is replaced
- **THEN** old or unauthorized derived bytes are hidden, including through a previously issued view/download URL

### Requirement: Generate bounded searchable pages in the worker

The existing OCR-ready extraction lane SHALL generate copies in the background using the stored original, bounded cropped/rotated page rendering, Tesseract page-image-plus-invisible-text PDF output, and qpdf assembly. Every source page SHALL be represented; a partial document SHALL NOT be published as ready. The configured OCR page cap, existing 300-DPI/4000px rendering ceiling, one raster page at a time, tool abort/time/output bounds, 15-minute work deadline and 100-MiB output cap SHALL apply. Output exceeding budgets or permanently unprocessable input SHALL become failed without changing ready search text. A generation that reaches the 15-minute work deadline SHALL fail permanently without automatic retry; a reader MAY request preparation again. Missing required tools SHALL leave jobs pending until the worker is corrected. Generation SHALL preserve the rendered appearance and aligned text/image positions while leaving the original immutable; rasterized copies MAY have different zoom fidelity, OCR accuracy or rounded page dimensions.

#### Scenario: Two-column scanned reading

- **WHEN** the worker converts an eligible scanned PDF with columns, tables and incidental selectable text
- **THEN** the derived document shows rendered source pages with invisible aligned OCR text and includes the complete source page count without duplicated original text layers

#### Scenario: Budget or processing failure

- **WHEN** a PDF exceeds the configured page/size/time budget or generation cannot complete
- **THEN** no partial ready copy is served, the generation is failed or retryable as appropriate, and original download/search text remain available

### Requirement: Fence generation and clean derived storage

Derived metadata SHALL belong to its immutable course file through a foreign key and a generation identifier. A worker SHALL publish only while it holds the current job lease and matching pending generation and the source remains a current live resource revision. Stale or failed attempts SHALL remove or durably queue cleanup of uploaded derived objects. Replacement, file/resource removal and course deletion SHALL durably remove related derived objects before dropping their last metadata reference. Cleanup and final publication SHALL coordinate locks so deleted or retired files cannot acquire an orphan ready artifact. Retried generations SHALL use distinct object keys so stale jobs cannot overwrite a current result.

#### Scenario: Replacement races completion

- **WHEN** the source is replaced or removed while generation uploads its result
- **THEN** the stale result is not published and its derived object is removed or durably queued for removal

#### Scenario: Storage outage during cleanup

- **WHEN** object storage fails during file or course cleanup
- **THEN** durable cleanup retains the derived key and retries rather than silently orphaning the object

### Requirement: Searchable PDF option in the file text panel

For PDF uploads, the existing extracted-text panel SHALL offer Searchable PDF alongside the readable/original text views. Selecting it SHALL prepare on demand, show pending and failed/retry states, and offer a titled native PDF embed plus open/download fallback links when ready. Polling SHALL run only while the selected mode is open and pending, every two seconds for the first 30 seconds and every ten seconds afterward. After 16 minutes of pending responses, automatic polling SHALL stop, the preparing indicator SHALL be replaced by a taking-longer notice, and Check again SHALL start a fresh bounded check cycle. Polling SHALL also stop on close, mode change, replacement/version change or unmount. Non-PDF resources SHALL NOT show this option. Existing compact action rows, original download, text views and Download .txt SHALL remain available. The UI SHALL disclose that the rendered copy may have less zoom detail and retain access to the original. The PDF viewer SHALL not require a new browser library.

#### Scenario: Prepare and inspect the current PDF

- **WHEN** a reader chooses Searchable PDF for an existing upload
- **THEN** progress changes to an embedded searchable copy with separate open/download links, without requiring another upload

#### Scenario: Close or retry while preparing

- **WHEN** a reader closes the panel, changes mode or retries a failure
- **THEN** obsolete polling/requests are canceled and a retry prepares only one current generation without losing text-view or edit state

#### Scenario: Preparation remains pending

- **WHEN** a selected searchable copy remains pending for 16 minutes
- **THEN** automatic requests stop and a taking-longer notice offers Check again
- **AND** choosing Check again resumes status checks for the current resource
