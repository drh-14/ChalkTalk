## Why

Post list cards and Related questions currently strip Markdown punctuation and show LaTeX as source text. Readers cannot scan the formatting or formulas that appear in the post detail.

## What Changes

- Render post body previews in the feed and Related questions with the same Markdown and LaTeX renderer as the composer Preview and post detail.
- Keep feed cards and Related questions cards equal and compact within their lists, contain long previews, and preserve a single accessible navigation link per card by displaying author-supplied links as inert text within previews.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: formatted post list and Related questions previews.

## Impact

The web post views, renderer configuration, styling, and frontend tests change. Post storage and APIs remain unchanged.
