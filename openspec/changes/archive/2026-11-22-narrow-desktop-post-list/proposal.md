## Why

Give desktop post detail more space using the user-approved narrower post-list mockups, preserving actual ChalkTalk styling and the mobile layout.

## What Changes

- Desktop post-list track becomes clamp(20rem, 28.8%, 24rem); detail receives remaining space.
- Header alignment follows the actual live detail boundary. Other sections resolve the same shared CSS sizing source without a duplicated JavaScript formula.
- Geometry changes, root-font changes and route replacement trigger relevant remeasurement without observing editor text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- responsive-course-ui: desktop post-list sizing and live split-boundary alignment.

## Impact

styles.css, AppBar geometry marker, useCourseHeaderLayout and mocked-API browser tests only. No dependencies, API changes, typography/control redesign or mobile behavior change.
