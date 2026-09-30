## MODIFIED Requirements

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the discussion route SHALL fill the viewport below the course header with two full-height columns, the post list and the post detail pane, separated by a single divider and without enclosing rounded panels. The page itself SHALL not scroll on this route. The left-hand post cards and their Load more control SHALL occupy a visibly scrollable region. The Posts/Duplicate posts selector, search field, and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. The right-hand detail pane SHALL scroll independently of the post list, SHALL keep its accessible name, and SHALL be keyboard-focusable so its content can be scrolled without a pointer. Scrolling either column SHALL not move the other. On screens at or below 850px, the cards and the detail pane SHALL use natural page scrolling rather than nested scroll areas.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards and Load more move within the left-hand column while its controls remain available above the list and the post detail pane does not move

#### Scenario: A member reads a long post

- **WHEN** a member scrolls a selected post whose content is taller than the desktop window
- **THEN** only the detail pane scrolls, the post list and course header stay in place, and the page itself does not scroll

#### Scenario: A keyboard user scrolls the post detail

- **WHEN** a keyboard user moves focus to the desktop post detail pane
- **THEN** the pane is focusable by its accessible name and scrolls with the keyboard

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicate posts
- **THEN** duplicate review cards use the same keyboard-accessible scroll region

## ADDED Requirements

### Requirement: Posts are listed as flat rows and read at full width

Post cards in the left-hand list, including staff duplicate review cards, SHALL appear as full-width rows separated by dividers rather than individually bordered, rounded boxes. The selected row SHALL be distinguished by a tinted background and a leading accent bar in addition to its existing current-item state, so selection is not conveyed by color alone. Hover and keyboard focus SHALL remain visible on every row. In the detail pane, post content and the post composer SHALL use the full width of the pane, apart from its padding. The home page and course settings route SHALL keep their existing presentation.

#### Scenario: A member selects a post

- **WHEN** a member selects a post in the desktop list
- **THEN** its row shows the tinted background and accent bar, is marked as the current item, and the other rows show no selection

#### Scenario: A member reads on a wide screen

- **WHEN** a member opens a post on a wide screen
- **THEN** the post text spans the full width of the detail pane rather than a narrower column
