## ADDED Requirements

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the left-hand post cards and their Load more control SHALL occupy a viewport-bounded, visibly scrollable region. The Posts/Duplicate posts selector, search field, and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. On screens at or below 850px, the cards SHALL use natural page scrolling rather than a nested scroll area. The right-hand detail pane SHALL not be constrained by this feed behavior.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards and Load more move within the left-hand pane while its controls remain available above the list

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicate posts
- **THEN** duplicate review cards use the same keyboard-accessible scroll region
