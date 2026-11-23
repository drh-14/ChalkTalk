## MODIFIED Requirements

### Requirement: Course navigation remains usable at narrow widths

At widths of 320 and 390 CSS pixels, the course header SHALL retain course switching, notification/account controls, home navigation via the ChalkTalk logo and access to all existing available course sections without horizontal overflow. At 850px or narrower a compact current-section dropdown SHALL replace the visible section tab list. The logo SHALL link home without an All courses button and share its row with notifications/avatar; the course name/switcher and current-section control SHALL occupy the following row. Existing role visibility and unread indicators SHALL remain. Interactive targets SHALL remain touch-friendly (at least 44 CSS pixels high for mobile section navigation), and the layout SHALL avoid unnecessary header height. Desktop course navigation SHALL show every existing section link on the logo row beside the course identity, compacting controls and spacing without a desktop dropdown, unreadable labels or overflow; full-title discoverability SHALL be preserved.

#### Scenario: A member opens a course at 320 pixels

- **WHEN** the course page loads at 320 CSS pixels
- **THEN** the logo, notifications and avatar fit the top row, the course name/switcher and current section remain accessible below, and no horizontal overflow occurs

#### Scenario: A member navigates on a phone

- **WHEN** a member opens the current-section dropdown at 390 CSS pixels
- **THEN** all existing available course sections remain reachable through touch-friendly links, the active section is identified, and choosing one preserves existing guarded navigation
