## ADDED Requirements

### Requirement: Recoverable PDF validation

The shared upload validator SHALL accept PDF structure recovery when qpdf completes with warning-only status 3, provided all existing file boundary, positive page count and forbidden-content checks pass. Fatal parsing failures, scanner failures, missing tools, process signals and restricted PDF content SHALL remain rejected. Validation SHALL retain existing memory/output/time limits and SHALL NOT rewrite the uploaded original bytes.

#### Scenario: Recoverable cross-reference table

- **WHEN** an authorized instructor uploads a PDF with a recoverable cross-reference defect and no restricted content
- **THEN** upload returns 201 with the documented metadata and Location, and authorized download returns identical original bytes with the existing content type, length, attachment, nosniff and private no-store headers

#### Scenario: Restricted content after recovery

- **WHEN** qpdf recovers a PDF containing a forbidden action or other restricted content
- **THEN** upload returns 415 unsupported_media_type without persisting a visible file

#### Scenario: Unrecoverable PDF

- **WHEN** qpdf cannot parse the PDF or the existing boundary/page-count checks fail
- **THEN** upload returns 415 unsupported_media_type
