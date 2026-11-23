## Context

See proposal.md for motivation. Discussion currently uses a three-column grid above 850px and block layout below it. Width is a CSS clamp (11.5rem–13rem); only desktop renders collapse controls and applies inert state. Existing component tests cover desktop collapse and breakpoint transitions; `tests/browser/discussion-layout.spec.mjs` provides API mocking and screenshots.

## Goals / Non-Goals

**Goals:** Extend the existing layout locally without adding dependencies or changing feed, detail, or route state. Support pointer and keyboard resizing and safe local persistence.

**Non-Goals:** Navigation-sidebar changes, draggable feed/detail splitters, API persistence, mobile side-by-side columns, or changes to PR #269.

## Decisions

- **Mobile layout (user approved):** Keep filters above the full-width feed; use two-column compact accordion summary rows, modest padding and wrapped filter choices with usable touch targets. A bottom handle adjusts total panel HEIGHT rather than width. Fix the small collapse/header row and handle outside an internally scrolling body. Fully collapsed filters leave only a small expand strip (approximately 44px tall for touch). Shrinking the panel immediately moves the feed upward. Do not introduce side-by-side columns or width changes on mobile.
- **Desktop collapse control:** Preserve the existing `.filter-collapse-toggle` circular shape, original double-chevron SVG, colors, and directional behavior: full circle on the expanded boundary and half-round pull tab at the collapsed left edge with outward-pointing arrows. Add visible adjacent `Filters` text in both states without replacing the arrow with a pill/button redesign. The label remains fully readable, not clipped into the half-round arrow. Reserve layout room for the label and toggle hit target so neither overlaps search, filter content, or the resize handle; accessible name and expanded state remain explicit.
- **Desktop bounds:** Minimum 184px (existing desktop minimum), maximum 384px; additionally reserve at least 288px for feed and 280px for detail, accounting for actual grid padding/gaps. Clamp the effective minimum down if required by available container space. Default retains existing responsive desktop width. Resizing never implicitly collapses.
- **Mobile height bounds/default:** Default total panel height 156px, minimum 112px, maximum the lesser of 360px and 45% of available vertical space below the course header. Clamp the default to current bounds. In unusually short viewports, retain the 112px minimum instead of the 45% soft cap: 44px header, at least one 44px scrollable row, and the 22px clear edge inset must remain usable. The mobile page stays vertically scrollable so the feed remains reachable. Panel height includes the header, body and a 22px clear inset at the lower edge; only its body scrolls. A small centered grip is the only visible resize affordance: no explanatory prompt or dedicated handle row. Its invisible 72px-wide by 44px-high target overlaps the bottom edge (22px inside and 22px outside); retain the 22px internal clear inset and at least 24px feed top spacing so the target cannot overlap filter buttons or feed controls. These are implementation defaults, not a change to the approved interaction.
- **State:** Keep separate preferred desktop width and mobile height in Discussion and dedicated localStorage keys shared across courses; render effective clamped dimensions via CSS custom properties. Do not save viewport-only clamps. Validate finite positive values at the storage boundary and tolerate storage errors. Every fresh course discussion mount starts collapsed on both desktop and mobile. Do not persist expanded state; expansion during that mount restores the saved dimension for the current breakpoint. Only preferred dimensions persist.
- **Input:** Use Pointer Events and pointer capture. Desktop measures horizontal delta; mobile measures vertical delta. A bottom touch target approximately 44px high overlaps the edge without consuming a dedicated row; its clear insets keep it separate from collapse, filter buttons, and feed controls. Apply `touch-action: none` only to handles. End on pointerup/cancel/lost capture and clean up on unmount or breakpoint change. Disable layout transition during active drag.
- **Accessibility:** Focusable separator named Resize filters with aria-controls and dimension values in pixels. Desktop uses vertical orientation and Left/Right keys; mobile uses horizontal orientation and Up/Down keys; both step by 10px and support Home/End. Restore focus to the visible collapse control when needed. Hide handle and body on collapse; keep expand reachable at every breakpoint.
- **Testing seams:** Component tests exercise keyboard/state/storage and selection preservation; real-browser mocked API tests exercise actual geometry, desktop mouse drag, mobile vertical touch drag, internal scrolling, feed moving upward when shrunk, collapse/expand, separate saved dimensions, viewport changes, and no horizontal overflow. Existing collapse-breakpoint expectations must be revised intentionally for mobile collapse support.

## Risks / Trade-offs

- [Compact panel hides lower controls] → internal scrolling with visible scroll affordance; test that folders/tags remain reachable at minimum height.
- [Handle competes with scrolling or collapse tab] → distinct target, scoped touch-action, pointer capture, browser tests of touch and cancellation.
- [Desktop widths exhaust detail space] → measure container, reserve content widths and clamp on ResizeObserver updates.
- [Storage blocked or invalid] → guarded access and component tests; width remains usable in memory.

## Migration Plan

No migrations or dependency changes. New storage preference is optional; rollback ignores it. Complete browser verification, archive change, run no-mistakes and deliver one-commit draft PR separate from #269.
