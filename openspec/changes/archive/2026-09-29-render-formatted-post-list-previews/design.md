## Context

`PostBody` renders sanitized Markdown and KaTeX in composer Preview and post detail. Feed and Related questions cards currently call `excerpt`, which strips selected Markdown punctuation and truncates plain text. The cards themselves are links.

## Decisions

- Use `PostBody` in both card types so supported Markdown, math, sanitization, and malformed math handling stay consistent with detail.
- Add a preview option to `PostBody` that renders Markdown link labels without anchor elements and image alt text without image elements. This avoids nested links, prevents a card from loading an author-supplied image URL, and keeps each card as one keyboard navigation target.
- Give feed and duplicate cards a fixed 7.5-rem height and Related questions cards a fixed 6-rem height. Clamp long titles to two lines and let the rendered preview use the remaining space, fading its lower edge before clipping long content. A display formula may extend beyond a compact preview; the full body remains available in post detail. Fixed dimensions are scoped to each list because their card contents differ.

## Verification

Add a UI test proving bold/math rendering and inert link labels in both card types, then run the affected test, frontend checks, and a browser flow with mocked API at desktop and narrow widths. In the browser, compare card heights across short and long content and inspect clipped previews and navigation.
