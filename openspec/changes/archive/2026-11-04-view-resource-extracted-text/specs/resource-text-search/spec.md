## ADDED Requirements

### Requirement: Read current extracted resource text

The API SHALL expose GET /api/v1/courses/{courseId}/resources/{resourceId}/text to current members who may read the resource in an active or archived course. Success SHALL be 200 application/json with Cache-Control private, no-store and {data:{fileId,status,text,truncated}} for only the active upload revision. Status SHALL be pending, ready, failed or unsupported. Text SHALL be the stored plain text only when ready, otherwise null; truncated SHALL describe ready text and otherwise be false. Missing extraction rows SHALL report pending. No failure codes SHALL be returned. Missing authentication SHALL return 401; nonexistent, deleted, hidden, wrong-course, non-upload or inaccessible resources SHALL return 404; unavailable service SHALL return 503. Read authorization, revision and text SHALL share one consistent snapshot.

#### Scenario: Ready and truncated text

- **WHEN** a member opens the text of an accessible ready upload
- **THEN** the full stored text including literal markup, its file ID and truncation flag are returned with private no-store caching

#### Scenario: Extraction unavailable

- **WHEN** extraction is pending, failed or unsupported
- **THEN** the state is returned with null text and truncated false

#### Scenario: Permission or revision changes

- **WHEN** a resource is replaced or removed, access is revoked, or a student requests a staff-only resource or section
- **THEN** old or unauthorized text is never returned and inaccessible resources return 404

### Requirement: Inspect extracted text in Resources

Uploaded-file cards in catalog and search results SHALL offer View extracted text to authorized readers. On catalog cards, the text action SHALL share a compact wrapping action row with Edit and Remove, using short visible action labels and resource-specific accessible names. The expanded text panel SHALL appear below that action row. Opening SHALL fetch text on demand and expand an accessible inline region. It SHALL show loading, empty, truncated and unavailable states; errors SHALL offer retry. Pending text SHALL offer Refresh text. Text SHALL render as plain text, wrap long lines and scroll within a bounded panel without horizontal page overflow. Close SHALL abort pending requests and collapse the panel; reopening SHALL fetch fresh data. Links SHALL NOT offer the action.

#### Scenario: Inspect text and return

- **WHEN** a reader opens a file's extracted text and then closes it
- **THEN** the full text is readable as text and the card returns to its collapsed state with its original download and draft state preserved

#### Scenario: Mobile inspection and retry

- **WHEN** a reader opens text at a mobile viewport or retries a failed request
- **THEN** the panel remains within the card and a successful retry replaces the error

### Requirement: OCR scanned pages with incidental text

PDF pages SHALL receive OCR when they have fewer than 20 non-whitespace text characters, or fewer than 500 non-whitespace characters together with a raster image or stencil covering at least half the page area. Small selectable headers and footers SHALL NOT prevent OCR of scan-dominated pages. Image coverage SHALL use bounded Poppler metadata and physical image size. Existing OCR page limits, deadlines, render bounds, stored text limits and original-file preservation SHALL remain intact. Dense selectable-text pages and sparse pages without large images SHALL retain text-layer extraction. An OCRed page SHALL store one text source, because the render already includes selectable text: its OCR text when OCR recognizes more non-whitespace characters than a layer of fewer than 20 characters, or more than 1.5 times a usable layer plus 20 characters, otherwise its exact selectable text. An unmeasurable image row or an overflowing image listing SHALL NOT fail extraction; such images SHALL NOT establish scan dominance. When the OCR page cap or deadline skips a page with usable selectable text and it is the only page in the file that needed OCR, that page SHALL keep its selectable text and SHALL NOT alone mark the result truncated. A scan page left unread after any other page was OCRed, or with another page still needing OCR, SHALL mark the result truncated.

#### Scenario: Scanned reading with selectable footer

- **WHEN** a scanned reading page contains a selectable copyright footer but the article body is a large raster image or stencil
- **THEN** its recognized article body is included in stored and searchable text

#### Scenario: Image-backed slide with noisy OCR

- **WHEN** a slide has about 300 selectable characters over a full-page background image and OCR recognizes a similar or slightly larger amount of noisy text
- **THEN** its exact selectable text is stored and the OCR text is not

### Requirement: Readable extracted text and text download

The extracted-text panel SHALL default to a readable view that joins soft line breaks within prose and obvious lower-case continuations across spurious blank lines, while retaining paragraph boundaries, headings, lists and recognizable table/code blocks. It SHALL preserve the OCR's column/block reading order rather than sort or interleave columns. Formatting SHALL be a reversible presentation transform: stored/search text SHALL remain unchanged, and Original line breaks SHALL show the stored text. OCR recognition errors and table structure SHALL NOT be represented as automatically corrected.

Ready text SHALL offer Download .txt beside the panel actions. The UTF-8 text file SHALL match the selected readable/original view, use a safe resource-derived .txt filename and avoid embedding HTML. Download links SHALL be unavailable while loading or when text is not ready. Temporary browser URLs SHALL be revoked when replaced or closed.

#### Scenario: Read and download paragraphs

- **WHEN** a reader opens ready extracted text and downloads the readable view
- **THEN** wrapped prose appears as readable paragraphs and the UTF-8 download contains that displayed text

#### Scenario: Preserve original text and structured blocks

- **WHEN** a reader selects Original line breaks or views a heading, list or table-like block
- **THEN** original line breaks remain available and the presentation transform does not change stored text
