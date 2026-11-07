## MODIFIED Requirements

### Requirement: Catalog files receive extracted text

The system SHALL extract plain text, in the background, from the file behind each live upload entry in the course resource catalog. Extraction SHALL be self-hosted and SHALL NOT send file content to any external service. By media type:

- PDF: each page's embedded text SHALL be used when the page has usable text. Pages without usable embedded text SHALL be OCR'd, up to 200 OCR'd pages per file.
- PNG, JPEG and WebP: the image SHALL be OCR'd.
- Plain text and Markdown: the content SHALL be decoded as UTF-8, with invalid sequences replaced.
- DOCX and PPTX: the visible text of the document body, slides and speaker notes SHALL be extracted. Embedded images SHALL NOT be OCR'd.

Stored text SHALL be limited to 500,000 characters. Office XML parts with a declared uncompressed size over 64 MiB SHALL NOT be decompressed for extraction. Skipping a PPTX slide or speaker-note part SHALL mark the retained text as truncated, including an empty result when all wanted parts are skipped; unrelated archive entries SHALL NOT affect truncation. A missing or skipped DOCX body SHALL remain a permanent damaged-file failure. When the text is cut short, by the page limit, the character limit, the Office part limit or the final attempt's OCR time limit, the result SHALL record that it was truncated.

OCR SHALL use the English (`eng`) language data. OCR page and language settings SHALL not depend on deployment environment variables.

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

- **WHEN** a file has more than 200 pages that need OCR
- **THEN** only the first 200 such pages are OCR'd, the extracted text is searchable, and the result is marked truncated

#### Scenario: OCR reaches the time limit on the final attempt

- **WHEN** the final extraction attempt for a scanned PDF has been running for 12 minutes and pages still need OCR
- **THEN** OCR stops, the text of finished pages is searchable, the text status is `ready`, and the result is marked truncated

#### Scenario: An earlier attempt reaches the job time limit

- **WHEN** an extraction attempt other than the final one reaches the 15-minute job limit
- **THEN** the attempt is aborted, no text is stored, and extraction is retried

#### Scenario: Instructor uploads slides with speaker notes

- **WHEN** an instructor uploads a PPTX whose slides and speaker notes contain text
- **THEN** both slide text and notes text become searchable

#### Scenario: Environment cannot change OCR settings

- **WHEN** deployment environment variables name another OCR page cap or language
- **THEN** extraction still caps PDF OCR at 200 pages and uses English
