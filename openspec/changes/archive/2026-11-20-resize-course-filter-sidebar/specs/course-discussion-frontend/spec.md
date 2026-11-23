## MODIFIED Requirements

### Requirement: The filter sidebar collapses behind a pull tab

On every fresh course discussion mount, filters SHALL default to collapsed on desktop and mobile. A button SHALL collapse and expand the filter panel on desktop and mobile, exposing its state with `aria-expanded`. Expanded state SHALL NOT persist across mounts or reloads; expanding SHALL restore the separately saved desktop width or mobile height, constrained by current bounds. On screens wider than 850px, the collapse/expand control SHALL preserve its existing circular arrow styling, original double-chevron icon, and directional behavior (full circle expanded, half-round pull tab with outward-pointing arrows collapsed). Visible `Filters` text SHALL sit adjacent to the arrow in both states and remain fully readable and reachable when collapsed, without redesigning the arrow as a labeled pill. Its label and hit target SHALL NOT overlap search, filter content, or resize controls. On narrow screens, an accessible collapse/expand control SHALL remain visible above the feed. Collapsed filter contents SHALL be hidden from keyboard and assistive-technology navigation. Collapse and expansion SHALL retain filter selections and preferred expanded dimensions, without requesting feed data solely for the layout change.

#### Scenario: Initial filters are collapsed on both viewport sizes

- **WHEN** a member opens or reloads a course discussion on desktop or mobile
- **THEN** filters start collapsed with an accessible expand control, and expanding restores the corresponding saved width or height without losing filter selections

#### Scenario: A member hides the filters

- **WHEN** a member collapses the filter sidebar on a wide screen
- **THEN** the post list widens, the labeled Filters control remains fully visible, and activating it reopens the sidebar with the same filters selected

#### Scenario: A member hides mobile filters

- **WHEN** a member collapses filters on a narrow screen
- **THEN** the panel contents disappear, the feed remains full width, and an accessible expand control restores the same filters and height

## ADDED Requirements

### Requirement: Members can resize course filters across screen sizes

The expanded in-course filters panel SHALL provide a right-edge WIDTH handle on screens wider than 850px and a bottom-edge HEIGHT handle on screens 850px or narrower, usable with mouse, touch, and keyboard. Handles SHALL expose their accessible name, separator role, axis-appropriate orientation, current dimension, and bounds. Desktop Left/Right and mobile Up/Down arrow keys SHALL resize by 10 pixels; Home/End SHALL select the current minimum/maximum. Effective dimensions SHALL fit available space without horizontal page overflow. Mobile filters SHALL use a compact layout above the full-width feed, with a fixed header and a small centered bottom-edge grip outside an internally scrolling body. The grip SHALL have a touch-friendly hit target without a dedicated prompt row, and its target SHALL not overlap filter buttons or feed controls. Shrinking the mobile panel SHALL move the feed upward without reducing its width. Collapse SHALL be separate; dragging to minimum size SHALL not collapse filters.

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

### Requirement: Preferred filter dimensions survive reloads and viewport changes

The browser SHALL retain the last explicitly chosen desktop expanded width and mobile expanded height separately across reloads and courses. Rendering SHALL clamp each preference to its current viewport bounds without replacing saved preferences solely because space shrinks or the breakpoint changes. Missing, malformed, or inaccessible browser storage SHALL fall back to usable defaults without preventing filter interaction.

#### Scenario: Reload restores independent dimensions

- **WHEN** a member chooses desktop width and mobile height and reloads a course at either breakpoint
- **THEN** filters start collapsed and restore the corresponding saved dimension constrained by available space when expanded

#### Scenario: A smaller viewport temporarily constrains size

- **WHEN** a viewport shrinks below its saved preferred dimension and subsequently grows again
- **THEN** rendered filters fit smaller space and restore the preferred dimension when space becomes available, without replacing the other breakpoint's preference

#### Scenario: Storage is unavailable

- **WHEN** browser storage cannot be read or written or contains invalid dimensions
- **THEN** the course remains usable and filters can still resize and collapse
