## Context

See proposal.md. Links are rendered in several frontend components. Some external links already use a new tab, while file links and Markdown links do not.

## Goals / Non-Goals

**Goal:** Make browser-tab semantics consistent without changing navigation routing or file endpoint behavior.

**Non-goal:** Change internal post-to-post links or browser download policies.

## Decisions

- Add `target="_blank"` and `rel="noopener noreferrer"` at external and file link render sites. This matches existing course website behavior and avoids a routing abstraction for a small change.
- In Markdown, distinguish absolute HTTP(S) website links from relative app routes; only website links get a new tab. Mentions remain inert as before.
- Keep existing internal navigation anchors unchanged.

## Risks / Trade-offs

- Browsers may download a file rather than display it in the tab, depending on response headers; the original app tab remains intact either way.
