# Proposal

## Why

Imported Piazza posts with tables, such as the CSE 416 milestone grade distributions, show every cell as its own paragraph. The importer drops table structure, and the browser could not display a Markdown table anyway: post bodies are parsed as CommonMark only, while the digest email and notification text already parse GitHub-flavored Markdown (GFM).

## What Changes

- The browser renders post, answer, followup, and composer-preview Markdown with GFM: pipe tables, strikethrough, task-list checkboxes (read-only), and autolinked bare URLs. Rendering stays sanitized, with no raw HTML.
- Wide tables scroll horizontally inside the post body instead of widening the page.
- The Piazza importer converts HTML tables into GFM pipe tables, using the first row as the header row. Re-running the import updates previously imported posts.

## Capabilities

### New Capabilities

- `piazza-course-import`: table conversion when importing a Piazza class.

### Modified Capabilities

- `course-discussion-frontend`: Markdown bodies render GFM tables and related syntax.

## Impact

- `apps/web`: `PostBody` gains `remark-gfm` (already used by the API) and table styles.
- `apps/api/src/piazza-import/convert.ts`: a Turndown rule for `<table>`.
- No API, database, or migration changes. Existing posts whose text happens to contain GFM syntax (for example `~~text~~` or a bare URL) now render it.
