## Why

Members can write Markdown in a post body, but the composer offers no formatting controls or preview, and post detail cannot render mathematical notation. This makes course discussions—especially those involving equations—hard to author and read.

## What Changes

- Add an accessible body toolbar for bold, italic, heading, link, bulleted and numbered lists, inline code, inline math, and block math.
- Apply formatting to the body editor's selection or caret using Markdown and `$`/standalone `$$` math delimiters, and add a read-only Preview of the unsent draft.
- Use a source editor that checks Markdown/math after each text edit and marks complete LaTeX expressions rejected by the math parser with a red underline and accessible diagnostic text. Incomplete expressions and ordinary Markdown text remain unmarked.
- Render standard Markdown and KaTeX math consistently in Preview, ordinary post detail, and staff duplicate review while keeping author content untrusted.
- Keep post cards and related-question summaries as plain text, and continue submitting and storing the original `bodyMarkdown` string.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: define formatting insertion, Preview, and safe Markdown/LaTeX rendering for post bodies.

## Impact

The change affects the web post composer, detail views, styles, frontend tests, and frontend editor/Markdown/math dependencies. The posts API, database schema, identity visibility, and full-text search contract do not change.
