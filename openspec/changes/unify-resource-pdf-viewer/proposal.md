# Proposal

## Why

PDF questions, extracted text and searchable copies currently live in separate interfaces. Readers need one document workspace with reliable question loading and refresh, preserved drafts and a usable mobile layout.

## What Changes

- Combine Original/Searchable copy rendering with Questions/Extracted text panels in the existing PDF viewer; catalog text actions enter that viewer with text selected.
- Retain downloads, readable/original extracted text and generation retry/check-again behavior.
- Distinguish question loading, error and successful empty states; retain content on refresh failures.
- Refresh visible questions every 15 seconds and on tab return, preserving page, zoom, selection and drafts. Detect replacement and require explicit reload.
- Use mobile PDF/Questions/Extracted text tabs and measure available viewport height from the actual header/layout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `slide-anchored-questions`: unified PDF variants, panel navigation, explicit question states, stable refreshing and mobile layout.
- `resource-searchable-pdfs`: present searchable output inside the existing PDF viewer and preserve bounded generation polling and downloads.

## Impact

Frontend slides, catalog extracted-text actions, routing and shared PDF loading. Reuse existing authenticated API, generation worker and pdf.js dependency; no new service or database migration. Original file identity remains authoritative for anchors. Tests and gates remain deferred at the user's request; validation tasks stay unchecked.
