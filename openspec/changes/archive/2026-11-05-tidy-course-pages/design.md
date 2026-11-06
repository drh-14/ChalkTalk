# Design

## Decisions

- **The account menu replaces inline controls.** Sign out keeps its accessible name and draft guard. The menu closes on Escape and outside pointer presses.
- **The course switcher becomes the course name.** The switcher button overlays the name pill, so the heading stays a real `h1` for focus management while the whole name is clickable.
- **Feed sections are computed in the browser** from loaded posts and the current sort, with no API change. The pinned section is only the leading run of pinned posts, so sorts without pin precedence fall back to dates. Weeks run Sunday to Saturday, like Piazza.
- **One shared empty-state component** holds inline SVG illustrations colored through stylesheet classes. It adds no image assets or dependencies.
- **Two button sizes** are enforced through `.button` (40px) and `.button.compact` (33px), replacing per-page padding overrides. Buttons that stretch to sit beside an input keep the input's height.
