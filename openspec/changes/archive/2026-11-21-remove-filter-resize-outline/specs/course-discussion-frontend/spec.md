## MODIFIED Requirements

### Requirement: Members can resize course filters across screen sizes

The expanded in-course filters panel SHALL provide a right-edge WIDTH handle on screens wider than 850px and a bottom-edge HEIGHT handle on screens 850px or narrower, usable with mouse, touch, and keyboard. Handles SHALL expose their accessible name, separator role, axis-appropriate orientation, current dimension, and bounds. Desktop Left/Right and mobile Up/Down arrow keys SHALL resize by 10 pixels; Home/End SHALL select the current minimum/maximum. Effective dimensions SHALL fit available space without horizontal page overflow. Mobile filters SHALL use a compact layout above the full-width feed, with a fixed header and a small centered bottom-edge grip outside an internally scrolling body. The grip SHALL have a touch-friendly hit target without a dedicated prompt row, and its target SHALL not overlap filter buttons or feed controls. Shrinking the mobile panel SHALL move the feed upward without reducing its width. The resize handle SHALL show no focus outline for pointer or keyboard interaction; keyboard resizing and touch input SHALL remain available. Collapse SHALL be separate; dragging to minimum size SHALL not collapse filters.

#### Scenario: Mouse resize preserves course state

- **WHEN** a desktop member drags the right-edge handle left or right
- **THEN** expanded width follows the pointer within bounds without changing selected filters or requesting feed data solely for resizing

#### Scenario: Vertical touch resizing gives the mobile feed more room

- **WHEN** a mobile member drags the bottom handle upward
- **THEN** panel height decreases within bounds, its body scrolls internally, and the full-width feed moves upward without horizontal page overflow

#### Scenario: Lower mobile controls remain reachable

- **WHEN** a member scrolls inside the shortened mobile filters panel
- **THEN** lower filter controls remain reachable while the panel header and bottom handle stay available

#### Scenario: Keyboard resizing exposes current dimension

- **WHEN** a member focuses the handle and uses its axis-appropriate arrow keys, Home, or End
- **THEN** size changes within bounds and the accessible current value reflects rendered width on desktop or height on mobile

#### Scenario: A resize gesture ends outside the handle

- **WHEN** an active resize pointer is released or cancelled outside the handle
- **THEN** resizing ends and subsequent pointer movement does not change size
