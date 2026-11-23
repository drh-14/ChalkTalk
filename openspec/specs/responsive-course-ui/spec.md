# responsive-course-ui Specification

## Purpose

Keep course content and navigation usable across narrow and wide viewports, including keyboard access to overflowing content and truncated titles.

## Requirements

### Requirement: Wide post content stays within the viewport

Rendered math and tables SHALL not widen the page on narrow screens. Content wider than its post SHALL be horizontally scrollable within the post. A table that overflows SHALL expose a visible scroll cue and a keyboard-accessible, named scroll region.

#### Scenario: A member reads a wide math expression on a phone

- **WHEN** the viewport is 390 CSS pixels wide and the post contains a wider rendered expression
- **THEN** the document does not overflow horizontally and the expression can be read by scrolling within the post

#### Scenario: A member reads a wide table on a phone

- **WHEN** a post table is wider than its container
- **THEN** the table has a visible horizontal-scroll cue and a keyboard user can focus and scroll the named table region

### Requirement: Course navigation remains usable at narrow widths

At widths of 320 and 390 CSS pixels, the course header SHALL retain course switching, notification/account controls, home navigation via the ChalkTalk logo and access to all existing available course sections without horizontal overflow. At 850px or narrower a compact current-section dropdown SHALL replace the visible section tab list. The logo SHALL link home without an All courses button and share its row with notifications/avatar; the course name/switcher and current-section control SHALL occupy the following row. Existing role visibility and unread indicators SHALL remain. Interactive targets SHALL remain touch-friendly (at least 44 CSS pixels high for mobile section navigation), and the layout SHALL avoid unnecessary header height. Desktop course navigation SHALL show every existing section link on the logo row beside the course identity, compacting controls and spacing without a desktop dropdown, unreadable labels or overflow; full-title discoverability SHALL be preserved.

#### Scenario: A member opens a course at 320 pixels

- **WHEN** the course page loads at 320 CSS pixels
- **THEN** the logo, notifications and avatar fit the top row, the course name/switcher and current section remain accessible below, and no horizontal overflow occurs

#### Scenario: A member navigates on a phone

- **WHEN** a member opens the current-section dropdown at 390 CSS pixels
- **THEN** all existing available course sections remain reachable through touch-friendly links, the active section is identified, and choosing one preserves existing guarded navigation

### Requirement: Statistics toggle has a touch-friendly target

The Show as tables/charts control SHALL have a touch target at least 44 CSS pixels high on narrow screens without obscuring adjacent content.

#### Scenario: Staff switch statistics presentation on a phone

- **WHEN** staff activate Show as tables or Show as charts
- **THEN** the presentation switches and the control remains at least 44 CSS pixels high

### Requirement: Course title remains discoverable

On wide screens the course title SHALL use available header space before truncating. At desktop and mobile widths, a truncated title's complete text SHALL be available on hover and keyboard focus without causing horizontal page overflow.

#### Scenario: A member visits a course with a long name

- **WHEN** the name does not fit in the desktop header
- **THEN** the title may ellipsize but the full name is discoverable without opening the switcher

### Requirement: Desktop header placement adapts to content fit

Above the existing mobile dropdown threshold, the course selector SHALL hug its content within the available title space. The desktop section navigation SHALL begin at the actual discussion detail-pane boundary when its natural nonwrapping labels and account controls fit to the right with existing spacing. If they do not fit, navigation SHALL follow the course selector with the existing responsive gap, including above the post-list pane. The stage SHALL depend on actual rendered content fit, not a fixed viewport-only breakpoint. Titles SHALL truncate only as needed for the available layout space, with existing full-title discovery. Labels, role visibility, guards, focus, notifications and account state SHALL be preserved without overlap or horizontal overflow. Selected and unselected detail states SHALL share this geometry; other course sections SHALL retain the equivalent split alignment. Mobile dropdown layout SHALL remain unchanged.

#### Scenario: A member opens a wide discussion

- **WHEN** natural section links and account controls fit right of the detail boundary at a wide desktop width
- **THEN** navigation starts at that boundary, a short selector stays content-sized and a long title truncates only within its available space

#### Scenario: A member opens a constrained desktop discussion

- **WHEN** natural navigation and account controls cannot fit right of the detail boundary
- **THEN** navigation follows the content-sized selector with the existing responsive gap, labels do not compress, and controls do not overlap or overflow

#### Scenario: Content changes without a viewport breakpoint

- **WHEN** rendered section or unread content changes the fit at the same desktop viewport
- **THEN** the layout selects the appropriate aligned or adjacent stage without remounting or losing focused controls

#### Scenario: Members use mobile navigation

- **WHEN** an instructor or student opens a course at 320 or 390 pixels
- **THEN** the existing current-section dropdown, role-visible links, full-title access, logo-home guard, notifications and account controls remain usable without horizontal overflow

#### Scenario: A short name fits at fractional text widths

- **WHEN** a short course name fits in the available desktop title space but its intrinsic font measurement is fractional
- **THEN** the full name remains visible without unnecessary ellipsis, the selector stays content-sized, and navigation retains its approved stage and spacing

### Requirement: Desktop post list uses the approved compact split

Above850 CSS pixels the post-list track SHALL be clamp(20rem, 28.8%, 24rem) of the discussion grid and the detail track SHALL receive all remaining width. Header navigation SHALL use the actual live detail boundary when aligned, including after root-font/layout changes without window resize. Non-discussion sections SHALL resolve equivalent geometry from the same sizing source, without a duplicated numeric fallback. Existing content-fit adjacent mode, typography, icons,44px controls, guards, focus, full-title discovery and no-overflow behavior SHALL remain. At850px or narrower the existing full-width feed and selected-detail/back behavior SHALL remain unchanged.

#### Scenario: Desktop members read posts at approved widths

- **WHEN** the grid is851,1024,1280,1440 or1600 CSS pixels wide with16px root font
- **THEN** the feed measures respectively320,320,368.64,384 or384 pixels within1px, its right edge meets detail.left and detail receives the remainder without overflow

#### Scenario: Relative sizes change without a window resize

- **WHEN** root font or rendered grid geometry changes and a header control is focused
- **THEN** the split follows the same CSS clamp, aligned navigation follows the current boundary when it fits, controls retain focus and no stale boundary persists

#### Scenario: Members change sections and return

- **WHEN** members leave discussion for another course section and return
- **THEN** equivalent shared split geometry positions the header and live feed/detail observations rebind without stale alignment or lost controls

#### Scenario: Mobile members read and navigate

- **WHEN** members use320,390 or850px widths, including selected-detail/back navigation
- **THEN** the existing full-width feed, dropdown, search/filter controls and focus behavior are unchanged without horizontal overflow
