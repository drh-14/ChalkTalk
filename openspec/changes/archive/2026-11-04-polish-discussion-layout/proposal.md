# Proposal

## Why

The discussion view looks unbalanced with real course content:

- **Feed cards:** tag chips start 20px left of the card text, and the type badge sits on its own line above the title. Long titles and previews are cut mid-word without an ellipsis, and the preview shows one line where the spec promises two.
- **Empty band:** a 64px empty band separates Create post from the list.
- **Sidebar:** every row shares one text edge, and the sidebar uses the same thin scrollbar as the list and post panes.
- **Feed controls:** Search and Create post are shorter.
- **Course tabs:** Threads, Collaboration, Course resources, Course settings, and Statistics share one 72rem content width.
- **Post view:**
  - The title is 37.6px against 16px body text.
  - Its actions are spread over four places: Delete at the top right, Follow at the far right, a lone oversized Edit button below the body, and Pin and Merge below a divider.

## What Changes

- **Feed cards:**
  - The type badge sits inline before the title, and the title wraps to at most two lines with an ellipsis.
  - The preview runs paragraphs together into two lines with an ellipsis.
  - Tag chips align with the card text.
- **Feed status row:** the unread count and Mark all read move into the reserved row above the list, next to the new-post status. That row replaces the empty band and no longer scrolls with the cards.
- **Post view:**
  - The title is smaller, and the Followup Discussions heading drops to the size of the answer headings.
  - All post actions sit in one toolbar under the byline and tags. Each is a same-size button with an icon and its existing label, in this order: Follow, Edit post, the staff actions (Pin/Unpin, Lock/Unlock discussion, Merge as duplicate), and Delete post last, set apart in the danger color.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: card header, preview, and tag alignment; the feed status row; one post action toolbar that replaces the separate Edit, Staff actions, and Delete placements.

## Impact

`apps/web/src/posts/views.tsx`, `apps/web/src/styles.css`, and their tests and browser specs. No API changes. Every action keeps its accessible name, permissions, and request behavior.
