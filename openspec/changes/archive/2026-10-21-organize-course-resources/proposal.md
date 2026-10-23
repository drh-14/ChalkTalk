## Why

Course resources need Piazza-like instructor-created sections, ordering and staff-only materials rather than a flat list.

## What Changes

- Instructor-created sections only, with zero presets; preserve existing items ungrouped.
- Managed titles, section assignment, manual/title/date order and replaceable immutable revisions behind stable resource IDs.
- Same-course membership and effective section/item staff visibility on every list and legacy/direct file download.
- Instructor catalog management independent of standalone file uploader permissions, atomic private uploads and reference-aware cleanup.

## Capabilities

### New Capabilities

- `organized-course-resources`: Instructor-created sections and versioned resource catalog with authoritative visibility.

### Modified Capabilities

- `course-files`: Catalog reference-aware read/delete checks and transactional upload association.
- `course-resource-links`: Catalog-backed named links instead of an unorganized listing.

## Impact

Migration029, resource service/HTTP/browser, narrow file-policy and worker cleanup guards, API/database and real-browser tests. No dependencies or extra standalone documentation.
