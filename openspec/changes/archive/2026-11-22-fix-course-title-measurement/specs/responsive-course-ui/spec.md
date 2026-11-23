## MODIFIED Requirements

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
