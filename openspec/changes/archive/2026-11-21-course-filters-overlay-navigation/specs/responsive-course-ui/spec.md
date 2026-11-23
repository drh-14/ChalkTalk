## MODIFIED Requirements

### Requirement: Course navigation remains usable at narrow widths

At widths of 320 and 390 CSS pixels, the course header SHALL retain course switching, notification/account controls, All courses navigation and access to all existing available course sections without horizontal overflow. At 850px or narrower a compact current-section dropdown SHALL replace the visible section tab list. All courses SHALL share the logo row with notifications/avatar; the course name/switcher and current-section control SHALL occupy the following row. Existing role visibility and unread indicators SHALL remain. Interactive targets SHALL remain touch-friendly (at least 44 CSS pixels high for mobile section navigation), and the layout SHALL avoid unnecessary header height. Desktop course navigation SHALL share the logo row, using the same current-section dropdown immediately beside All courses when full links cannot fit without overflow; full-title discoverability SHALL be preserved.

#### Scenario: A member opens a course at 320 pixels

- **WHEN** the course page loads at 320 CSS pixels
- **THEN** the logo, All courses, notifications and avatar fit the top row, the course name/switcher and current section remain accessible below, and no horizontal overflow occurs

#### Scenario: A member navigates on a phone

- **WHEN** a member opens the current-section dropdown at 390 CSS pixels
- **THEN** all existing available course sections remain reachable through touch-friendly links, the active section is identified, and choosing one preserves existing guarded navigation
