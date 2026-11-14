## MODIFIED Requirements

### Requirement: Searchable PDF option in the file text panel

For PDF uploads, Searchable copy SHALL be available alongside Original in the unified resource PDF viewer. Choosing a not-requested copy SHALL offer Prepare searchable copy without starting generation until the reader requests it. Pending, failed/retry, taking-longer/Check again and ready states SHALL remain available. Ready copies SHALL render within the same viewer with page navigation and zoom and separate open/download links; original download and readable/original text layouts with Download .txt SHALL remain available. Non-PDF resources SHALL NOT show this option. The UI SHALL disclose reduced zoom detail. Existing generation APIs, revision/visibility checks and generation budgets SHALL remain unchanged. Pending polling SHALL occur only while Searchable copy is selected, every two seconds for the first 30 seconds and every ten seconds afterward. After 16 minutes it SHALL stop and offer Check again. Mode change, reload and unmount SHALL cancel obsolete requests and timers. Copy data for a changed original-file ID SHALL NOT be rendered.

#### Scenario: Prepare and inspect the current PDF

- **WHEN** a reader chooses Searchable PDF for an existing upload
- **THEN** progress changes to an searchable copy rendered in the viewer with separate open/download links, without requiring another upload

#### Scenario: Close or retry while preparing

- **WHEN** a reader closes the panel, changes mode or retries a failure
- **THEN** obsolete polling/requests are canceled and a retry prepares only one current generation without losing text-view or edit state

#### Scenario: Preparation remains pending

- **WHEN** a selected searchable copy remains pending for 16 minutes
- **THEN** automatic requests stop and a taking-longer notice offers Check again
- **AND** choosing Check again resumes status checks for the current resource
