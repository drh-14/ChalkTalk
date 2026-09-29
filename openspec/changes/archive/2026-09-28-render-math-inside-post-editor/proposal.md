## Why

Preview renders formulas, but authors still see only LaTeX source while writing. Rendering complete valid formulas inside the editable body makes math-heavy posts easier to read without changing their stored Markdown.

## What Changes

- Show complete valid inline and standalone block math as KaTeX inside the CodeMirror body editor when the caret or selection is outside that expression.
- Reveal exact source when the caret touches either boundary, the selection intersects it, or the author clicks the rendered formula.
- Keep invalid and incomplete expressions visible as source, preserving red diagnostics for complete invalid math.
- Preserve raw `bodyMarkdown` as the only editable and submitted value, including across toolbar, clipboard, undo, and redo operations.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: define in-editor math projection and source-reveal behavior.

## Impact

The post composer, math analysis worker, styles, and frontend tests change. There is no API, database, or dependency change.
