# resource-text-search Specification

## Purpose

Make the contents of uploaded course resources searchable by extracting their text, including OCR of scanned pages and images, and letting members search visible resources by title and extracted text.

## Requirements

### Requirement: Catalog files receive extracted text

The system SHALL extract plain text, in the background, from the file behind each live upload entry in the course resource catalog. Extraction SHALL be self-hosted and SHALL NOT send file content to any external service. By media type:

- PDF: each page's embedded text SHALL be used when the page has usable text. Pages without usable embedded text SHALL be OCR'd, up to a deployment-configured maximum number of OCR'd pages per file (default 200).
- PNG, JPEG and WebP: the image SHALL be OCR'd.
- Plain text and Markdown: the content SHALL be decoded as UTF-8, with invalid sequences replaced.
- DOCX and PPTX: the visible text of the document body, slides and speaker notes SHALL be extracted. Embedded images SHALL NOT be OCR'd.

Stored text SHALL be limited to 500,000 characters. Office XML parts with a declared uncompressed size over 64 MiB SHALL NOT be decompressed for extraction. Skipping a PPTX slide or speaker-note part SHALL mark the retained text as truncated, including an empty result when all wanted parts are skipped; unrelated archive entries SHALL NOT affect truncation. A missing or skipped DOCX body SHALL remain a permanent damaged-file failure. When the text is cut short, by the page limit, the character limit, the Office part limit or the final attempt's OCR time limit, the result SHALL record that it was truncated.

Extraction SHALL apply only to files that are the active revision of a catalog resource. Course syllabus files, post and thread attachments, and external links SHALL NOT be extracted.

#### Scenario: Instructor uploads a PDF with a text layer

- **WHEN** an instructor uploads a lecture PDF whose pages contain embedded text
- **THEN** that file's text becomes searchable after extraction completes, without OCR being applied to those pages

#### Scenario: Instructor uploads a scanned worksheet

- **WHEN** an instructor uploads a PDF whose pages are images without embedded text
- **THEN** those pages are OCR'd and the recognized words become searchable

#### Scenario: Instructor uploads a photo of a printed handout

- **WHEN** an instructor uploads a JPEG photo of printed text
- **THEN** the OCR'd words become searchable

#### Scenario: A scanned PDF exceeds the OCR page limit

- **WHEN** a file has more pages that need OCR than the configured limit
- **THEN** only the pages within the limit are OCR'd, the extracted text is searchable, and the result is marked truncated

#### Scenario: OCR reaches the time limit on the final attempt

- **WHEN** the final extraction attempt for a scanned PDF has been running for 12 minutes and pages still need OCR
- **THEN** OCR stops, the text of finished pages is searchable, the text status is `ready`, and the result is marked truncated

#### Scenario: An earlier attempt reaches the job time limit

- **WHEN** an extraction attempt other than the final one reaches the 15-minute job limit
- **THEN** the attempt is aborted, no text is stored, and extraction is retried

#### Scenario: Instructor uploads slides with speaker notes

- **WHEN** an instructor uploads a PPTX whose slides and speaker notes contain text
- **THEN** both slide text and notes text become searchable

### Requirement: Extraction is queued with uploads and never blocks them

Creating a catalog file resource, or replacing a resource's file, SHALL durably queue extraction for the new file in the same transaction that makes the file current. Upload responses SHALL NOT wait for extraction, and an extraction failure SHALL NOT fail or roll back an upload. Retrying extraction for the same file SHALL produce one stored result. Retries after transient failures SHALL use the worker's bounded retry policy. An extraction job SHALL get 3 attempts in total. Attempts before the final one SHALL have no OCR time limit and SHALL be aborted and retried at a 15-minute job limit. Only the final attempt SHALL stop OCR after 12 minutes and keep the finished pages. An unreachable object store SHALL NOT use an attempt. If the final attempt fails for any other reason, the text status SHALL become `failed`. Live catalog files that existed before this capability SHALL be queued for extraction once by the database migration.

#### Scenario: Upload succeeds while extraction is pending

- **WHEN** an instructor uploads a resource file
- **THEN** the upload returns its normal success response immediately and the file's text status is `pending`

#### Scenario: Existing resources are backfilled

- **WHEN** the migration runs on a course that already has catalog files
- **THEN** each live catalog file is queued for extraction exactly once

#### Scenario: Instructor replaces a resource file

- **WHEN** an instructor replaces a resource's file
- **THEN** extraction is queued for the new file, and search stops using the old file's text immediately

#### Scenario: Final attempt loses its lease

- **WHEN** an extraction worker loses its lease, including on the final attempt
- **THEN** it leaves the text pending for the worker that reclaims the job, and cannot record a final failure for a job it no longer owns

#### Scenario: Object store is unreachable

- **WHEN** a connection-level error or a 5xx response stops the worker fetching a file from the object store, including on the final attempt
- **THEN** the job is requeued after 60 seconds without using an attempt, and the text stays `pending`

#### Scenario: Object store stalls until the job deadline

- **WHEN** the object request or its body stream stops responding until the hard job deadline, including on the final attempt
- **THEN** the download is aborted, the job is requeued after 60 seconds without using an attempt, and the text stays `pending`
- **AND** shutdown or lease loss during a download retains its respective requeue or reclaim behavior
- **AND** scratch-disk write failures and timeouts after download still count as normal failed attempts

#### Scenario: Stored object is missing or forbidden

- **WHEN** the object store answers that the file does not exist or may not be read
- **THEN** that counts as a failed attempt, and the text status becomes `failed` if it was the final attempt

#### Scenario: Publication waits past lease ownership

- **WHEN** a result write waits while the job owner or attempt changes, or its lease expires
- **THEN** ready, failed and unsupported outcomes SHALL be discarded, including text-size reduction retries, leaving pending text available to the current worker

#### Scenario: Oversized PDF pages need OCR

- **WHEN** a PDF includes a 14,400-point page and a letter-size page without usable text
- **THEN** the oversized page SHALL render at no more than 4,000 pixels on either side, and the letter-size page SHALL render at 300 DPI

### Requirement: Extraction status is visible on catalog upload entries

Each `kind: "upload"` entry returned by catalog listing and metadata reads SHALL include `textStatus`, which is one of:

- `pending`: queued or in progress.
- `ready`: text was extracted. This includes an empty result, such as a blank page.
- `failed`: retries were exhausted, or the file could not be processed, for example an encrypted or damaged PDF.
- `unsupported`: no extractor applies.

Link entries SHALL NOT include the field. The field SHALL NOT expose extracted text or error details. Adding it SHALL NOT change any other catalog field, ordering, ETag semantics or pagination behavior.

#### Scenario: Extraction finishes

- **WHEN** extraction of a resource's file completes
- **THEN** subsequent catalog reads report `textStatus: "ready"` for that upload entry

#### Scenario: Password-protected PDF

- **WHEN** extraction cannot open an encrypted PDF
- **THEN** the entry reports `textStatus: "failed"` and the resource remains downloadable and title-searchable

### Requirement: Members search visible resources by title and extracted text

`GET /api/v1/courses/{courseId}/resources/search` SHALL let any current member of an active or archived course search catalog resources. It SHALL require an authenticated session. It SHALL accept only these query fields:

- `q` (required): trimmed, 1–200 Unicode code points.
- `limit` (optional): a decimal integer from 1 to 50, default 20.
- `cursor` (optional): an opaque string of 1–2048 characters.

A resource SHALL match when its title or the ready extracted text of its current file matches the query by word stems. Resource titles SHALL also match close misspellings of query words. Links SHALL match on title only, and their URLs SHALL never be fetched. Results SHALL be ordered by relevance, with a title match ranked above a resource whose only match is in extracted text, then by resource ID.

Success SHALL return `200 application/json` with `Cache-Control: private, no-store` and the body `{ data: [...], page: { hasMore, nextCursor } }`. Each item SHALL be `{ resource, match }`:

- `resource` SHALL be exactly the catalog entry shape, including `textStatus` for uploads.
- `match` SHALL be `{ inTitle, snippet }`.
- `snippet` SHALL be null when extracted text does not match. Otherwise it SHALL be `{ text, highlights }`, where `text` is a plain-text excerpt of at most 300 characters containing matched words, and `highlights` is an ordered list of non-overlapping `{ start, length }` ranges in UTF-16 code units into `text`.
- Snippets SHALL NOT contain markup.

`nextCursor` SHALL be valid only for the same course, normalized query and viewer access level.

Error responses:

- Missing authentication: `401 authentication_required`.
- Missing, deleting or inaccessible course: `404 not_found`.
- Missing, blank, oversized, repeated or unknown query fields, an invalid limit, or a malformed or foreign cursor: `400 invalid_request`.
- Unavailable service: `503 service_unavailable`.

Pagination SHALL NOT be a snapshot of concurrent changes.

#### Scenario: Student searches for a concept inside lecture notes

- **WHEN** a student searches for "eigenvalues" and only the text of a visible lecture PDF contains it
- **THEN** that resource is returned with a snippet whose highlights cover the matched word

#### Scenario: Title match outranks body match

- **WHEN** one resource's title contains the query and another resource contains it only in extracted text
- **THEN** the title match is listed first

#### Scenario: Misspelled title search

- **WHEN** a member searches "sylabus" in a course with a resource titled "Syllabus"
- **THEN** the resource is returned

#### Scenario: Extraction not yet complete

- **WHEN** a member searches for a word that appears only inside a file whose text status is `pending`
- **THEN** that resource is not returned until extraction completes, and title matches still return it

#### Scenario: Invalid query

- **WHEN** a member sends an empty `q`, a `limit` of 51, or an unknown query field
- **THEN** the API returns `400 invalid_request`

#### Scenario: Snippet contains HTML-like text

- **WHEN** extracted text contains `<script>` characters
- **THEN** the snippet returns them as plain text and the browser renders them as text, not markup

### Requirement: Search enforces catalog visibility and lifecycle

Search SHALL apply the same authorization as catalog reads before ranking, counting or pagination:

- Current authenticated membership in the resource's course is required.
- Items in staff-only sections, and staff-only items, SHALL be visible only to current same-course TAs and instructors.
- Archived courses SHALL remain searchable by authorized members.

Removed resources SHALL NOT match, and neither SHALL text from a resource's previous files. This SHALL take effect from the moment the removal or replacement commits. Search responses and timing SHALL NOT reveal hidden resources.

#### Scenario: Student searches for text in a staff-only resource

- **WHEN** a student's query matches only the extracted text of a resource in a staff-only section
- **THEN** the response contains no item for it and the same `hasMore` as if it did not exist

#### Scenario: TA searches the same text

- **WHEN** a current TA in that course runs the same query
- **THEN** the staff-only resource is returned

#### Scenario: Instructor removes a resource

- **WHEN** an instructor removes a resource and a member immediately searches for words from its file
- **THEN** the removed resource is not returned

#### Scenario: Former member searches

- **WHEN** a user whose membership was removed searches the course
- **THEN** the API returns `404 not_found`

### Requirement: Extracted text follows file cleanup

When the worker deletes a retired or removed catalog file's stored bytes, it SHALL also delete that file's extracted text. When a course is deleted, its extracted text SHALL be deleted with it. Extracted text SHALL never become readable again for a deleted file.

#### Scenario: Replaced file is cleaned up

- **WHEN** the worker processes deletion of a file that was replaced
- **THEN** that file's extracted text no longer exists in the database

### Requirement: Resources page offers text search

The Resources page SHALL provide a labeled search field to every member. While the trimmed query is non-empty, after a short typing pause, the page SHALL show ranked results in place of the sectioned catalog. Each result SHALL show:

- the resource title as a download link for files, or as a new-tab link with `noopener noreferrer` for links;
- the section name, or "Ungrouped";
- the snippet, with each highlighted range emphasized as text.

The page SHALL support loading more results. It SHALL show an empty state when nothing matches and a recoverable error state that keeps the query. Clearing the query SHALL restore the catalog without losing its sort or section state.

TAs and instructors SHALL see a non-blocking indicator on file entries whose text status is `pending`, `failed` or `unsupported`, explaining that the file's contents are not yet, or not, searchable. Students SHALL NOT see this indicator. The layout SHALL remain usable at mobile widths.

#### Scenario: Member finds a resource by its contents

- **WHEN** a member types a word that appears inside a visible lecture PDF
- **THEN** the page lists that resource with its section name and a snippet emphasizing the word, and the title downloads the file

#### Scenario: No results

- **WHEN** the query matches nothing visible
- **THEN** the page shows an empty-results message and keeps the query editable

#### Scenario: Instructor searches while editing

- **WHEN** an instructor with an open section or resource editor searches and then clears the query
- **THEN** the editors are still open with their unsaved values, and their controls cannot be reached by keyboard or screen reader while results show

#### Scenario: Instructor sees a failed extraction

- **WHEN** an instructor views the catalog and a file's text status is `failed`
- **THEN** the entry shows an indicator that its contents are not searchable, while students viewing the same entry see no indicator
