## ADDED Requirements

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
