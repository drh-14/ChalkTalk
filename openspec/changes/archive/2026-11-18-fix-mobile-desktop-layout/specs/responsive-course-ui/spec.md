## ADDED Requirements

### Requirement: Wide post content stays within the viewport

Rendered math and tables SHALL not widen the page on narrow screens. Content wider than its post SHALL be horizontally scrollable within the post. A table that overflows SHALL expose a visible scroll cue and a keyboard-accessible, named scroll region.

#### Scenario: A member reads a wide math expression on a phone

- **WHEN** the viewport is 390 CSS pixels wide and the post contains a wider rendered expression
- **THEN** the document does not overflow horizontally and the expression can be read by scrolling within the post

#### Scenario: A member reads a wide table on a phone

- **WHEN** a post table is wider than its container
- **THEN** the table has a visible horizontal-scroll cue and a keyboard user can focus and scroll the named table region

### Requirement: Course navigation remains usable at narrow widths

At widths of 320 and 390 CSS pixels, the course header SHALL retain course switching, account controls, back navigation, and course tabs without horizontal overflow. Course-tab hit areas SHALL be at least 44 CSS pixels high, and the layout SHALL avoid unnecessary header height.

#### Scenario: A member opens a course at 320 pixels

- **WHEN** the course page loads at 320 CSS pixels
- **THEN** all primary controls remain visible and the header is no taller than necessary for its rows

### Requirement: Statistics toggle has a touch-friendly target

The Show as tables/charts control SHALL have a touch target at least 44 CSS pixels high on narrow screens without obscuring adjacent content.

#### Scenario: Staff switch statistics presentation on a phone

- **WHEN** staff activate Show as tables or Show as charts
- **THEN** the presentation switches and the control remains at least 44 CSS pixels high

### Requirement: Desktop course title remains discoverable

On wide screens the course title SHALL use available header space before truncating; if it still truncates, its complete text SHALL be available on hover and keyboard focus.

#### Scenario: A member visits a course with a long name

- **WHEN** the name does not fit in the desktop header
- **THEN** the title may ellipsize but the full name is discoverable without opening the switcher
