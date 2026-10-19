## Why
Course Resources must show named external links alongside actual original course files in one flat list.

## What Changes
- Persist minimal instructor-created named HTTP(S) links.
- Add a member-only unified resources list and instructor-only idempotent link creation.
- Make filenames the download links without extra Download text; link titles open safely in a new tab.
- Preserve all existing file APIs and permissions. No sections, categories, descriptions, OCR, search or portal features.

## Capabilities
### New Capabilities
- `course-resource-links`: named links and a unified file/link listing.
### Modified Capabilities
- `course-files`: Resources presentation uses unified entries, retaining immutable file APIs.

## Impact
One additive migration (017; 015 attachments and 016 channels are reserved), independent PostgreSQL service and HTTP routes, existing course-files UI, narrow API/OpenAPI/database parity and tests. No dependency, fetch, backfill or wrapper resources table.
