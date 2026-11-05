# Spec Delta

## ADDED Requirements

### Requirement: Extraction exposes truthful current progress

Authorized catalog upload metadata in list, search and single-resource reads SHALL include nullable `textProgress`. Pending uploads SHALL return `{phase,completedPages,totalPages}` with phase `queued`, `preparing`, `ocr` or `saving`. Queued/preparing/saving counts SHALL be null. OCR counts SHALL be integers with positive total and zero <= completed <= total. Terminal statuses SHALL return null progress; links SHALL omit the field. Missing progress or an inactive, expired or superseded worker attempt SHALL appear queued. Existing status values, resource versions, ETags, catalog ordering and pagination SHALL remain unchanged. Reads SHALL retain existing authentication, visibility, current-file binding, private no-store caching and error contracts; no internal job identifiers, attempts, object keys, failure codes or text SHALL be exposed through progress.

OCR counts SHALL describe completed OCR work pages and all pages requiring OCR in the inspected portion of the current PDF, including work beyond an OCR cap. Text-layer-only pages SHALL NOT inflate either count. Non-PDF extraction and unknown or zero OCR work SHALL use phase feedback without fabricated percentages. Completed pages SHALL advance only after that page's OCR attempt completes, even when the exact selectable layer is retained. Retry SHALL reset attempt progress; stale or lost-lease workers SHALL NOT change current progress or publish terminal results. Final status SHALL remain pending until text commits; partial/truncated results SHALL retain the existing truncation contract and SHALL NOT be represented as complete OCR coverage.

#### Scenario: Scanned PDF advances

- **WHEN** seven of eighteen required OCR pages finish in the active extraction attempt
- **THEN** authorized metadata returns pending with `{phase:"ocr",completedPages:7,totalPages:18}`
- **AND** terminal ready metadata returns null progress without changing the resource version

#### Scenario: Mixed text pages and capped OCR

- **WHEN** a PDF has ten text-layer-only pages and eight OCR-needed pages, with OCR capped at three
- **THEN** progress counts at most three completed out of eight OCR pages before saving
- **AND** the finished truncated result is not described as all eight OCR pages having been processed

#### Scenario: Lease loss and retry

- **WHEN** an attempt expires or is superseded and a new attempt starts
- **THEN** old progress is not exposed as live, and the new attempt starts from preparing with reset counters
- **AND** delayed writes from the old attempt cannot overwrite new progress or terminal text

#### Scenario: Permission, lifecycle and legacy rows

- **WHEN** a student requests a staff-only resource, membership is removed, or the resource/file is replaced or deleted
- **THEN** existing inaccessible-resource error behavior applies and old progress is never returned for the new revision
- **AND** a readable legacy pending row without progress returns queued, while legacy terminal rows return null progress

### Requirement: Resources refresh extraction state without replacing page state

While Resources is open, staff upload cards SHALL replace the generic pending notice with phase feedback and, during OCR, completed/total OCR pages plus a labeled accessible progress bar. The numeric label SHALL identify OCR work pages; no ETA SHALL be shown. Students SHALL retain the existing absence of card extraction notices, but any authorized reader of an open pending text panel SHALL receive progress. Failed/unsupported and ready/empty/truncated presentation SHALL retain their existing meanings.

Pending resource metadata checks SHALL be coalesced by current course/resource/file identity with no overlapping request for that identity and at most four concurrent checks per page. Checks SHALL run every two seconds initially, slow to ten seconds after thirty seconds, pause in a hidden browser tab, and stop at terminal state, removal, file replacement or unmount. Resource edits that keep the same file SHALL NOT interrupt checks or change loaded edit versions; a replaced file SHALL stop the old check with a reload notice instead of Check again. A visible checking cycle SHALL stop after sixteen minutes and offer Check again; returning to a visible tab or choosing Check again SHALL start a fresh bounded cycle. Transient request failures SHALL keep existing state with recoverable feedback and bounded retries; authorization loss SHALL clear inaccessible progress/text. Updates SHALL merge only extraction status/progress into matching loaded entries, preserving catalog/search pagination, snippets, sort, selection, open editors, files and unsaved drafts. Late responses SHALL NOT resurrect an old resource or overwrite a replacement.

#### Scenario: Instructor observes progress while editing

- **WHEN** a pending resource advances while an instructor has unsaved catalog edits and more than one loaded page
- **THEN** its progress updates without reloading the page or resetting drafts, loaded pages, sort or section state

#### Scenario: Catalog and search share a pending file

- **WHEN** the same pending identity is displayed through existing catalog/search state and an open text panel
- **THEN** one shared metadata check cycle updates matching state without clearing results, snippets or cursors

#### Scenario: Hidden tab and prolonged preparation

- **WHEN** the tab is hidden or a pending resource stays pending for sixteen visible-cycle minutes
- **THEN** requests pause or stop respectively
- **AND** visibility return or Check again resumes a bounded current-identity cycle

#### Scenario: Replacement or inaccessible resource races a poll

- **WHEN** an old metadata response arrives after replacement, deletion, query change or authorization loss
- **THEN** it does not overwrite the current identity or restore inaccessible text/progress

### Requirement: Open pending text becomes readable automatically

An expanded pending extracted-text panel SHALL check lightweight metadata and fetch full text once when its current upload becomes ready, displaying that text without page reload or manual Refresh text. It SHALL preserve the chosen readable/original layout and regenerate Download .txt for the completed current text. It SHALL NOT fetch full text on every progress tick. Initial expansion and manual Refresh text/Retry SHALL remain available. Closing, mode/resource identity change and unmount SHALL cancel obsolete work; obsolete responses SHALL NOT reopen the panel or replace current text. Searchable PDF status/generation SHALL remain a separate process.

#### Scenario: Extraction completes while text panel is open

- **WHEN** an authorized reader opens pending text and extraction later becomes ready
- **THEN** the panel automatically fetches and displays completed text with its empty/truncated semantics and working text download
- **AND** it does not require a page refresh or repeatedly download full text while pending

#### Scenario: Closed or replaced pending panel

- **WHEN** a reader closes the panel or its file changes before a poll or text fetch completes
- **THEN** obsolete work is canceled and its response cannot reopen or overwrite the panel
