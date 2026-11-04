# Design

## Decisions

- **Icons with labels.** The user chose icons alongside the existing labels over icon-only buttons or an overflow menu. Labels keep each action recognizable and keep accessible names, so existing tests and assistive technology still find "Edit post", "Pin", and so on. Icons are inline Lucide-style SVGs, matching the pin and bell already in the app. No icon dependency is added.
- **One toolbar above the body.** It sits after the byline and tags, so actions are visible without scrolling long posts. This replaces the earlier rule that Edit follows the body. The Staff actions group stays a named group inside the toolbar, rendered with `display: contents` so its buttons flow in the same row.
- **Status row instead of an empty slot.** The new-post status needs a stable slot above the list. That slot now also holds the unread summary, which previously scrolled with the list, so the reserved space always has a purpose.
- **Card text clamping.** The badge becomes inline content of a two-line clamped title. Preview paragraphs, list items, and headings display inline inside a two-line clamp, so the ellipsis lands at the true end of the visible text. Cards no longer use a fixed height; the title and preview clamps bound the card's size.
- **Title scale.** The post view title goes from `clamp(1.55rem, 2.6vw, 2.35rem)` to `clamp(1.4rem, 1.9vw, 1.85rem)`, about 30px on a 1920px screen.
