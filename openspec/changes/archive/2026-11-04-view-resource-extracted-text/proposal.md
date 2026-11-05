# Why

Resource search exposes snippets but no way to inspect the full extracted text. Long reorder buttons consume card space.

# What Changes

Add a View extracted text action to uploaded-file cards and search results. Expand a plain-text panel on demand with loading, pending/failed/unsupported, empty, truncated, retry and close states. Correct OCR detection so scanned article images with small selectable footers are actually read. Compact instructor resource ordering into accessible arrow buttons on the right of the card.

# Capabilities

## Modified Capabilities

- `resource-text-search`: authenticated full extracted text and inline viewer.
- `organized-course-resources`: compact resource ordering controls.

# Impact

Existing resource service, HTTP API, frontend client/cards, reference docs and tests. No new dependency, migration or service. Existing PDF warning fix is preserved. User requested demo work before no-mistakes/publication.
