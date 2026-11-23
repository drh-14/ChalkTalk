## MODIFIED Requirements

### Requirement: Mobile discussion tools share a compact toolbar

At 850px or narrower, Search and New post SHALL be icon buttons with accessible names and touch-friendly targets, sharing one row with the text Filters button in that order. Activating Search SHALL reveal and focus a search field below the toolbar without changing existing query/filter semantics. Escape SHALL close the field and return focus to Search; closing and reopening SHALL retain its query. The existing slash shortcut SHALL reveal and focus mobile search. Desktop SHALL retain a full search field with Filters immediately to its right and New post on the same row, with no button wrapping or horizontal overflow. Desktop New post SHALL be a 44px plus icon button with accessible name New post, preserving composer, disabled and archived saved-draft behavior. Mobile Search SHALL show a green border if and only if its input is open/aria-expanded true, even with an empty query. Outside pointer dismissal SHALL hide the input and remove this border without clearing the query or stealing outside-target focus. Interactions inside the input region including Clear SHALL NOT dismiss it. No yellow active treatment SHALL be used. Breakpoint changes SHALL NOT strand focus in hidden controls.

#### Scenario: A member searches on a phone

- **WHEN** a member opens Discussion at 320px or 390px and activates the Search icon
- **THEN** Search, New post and Filters remain on one row, a labelled search field opens below that row and receives focus, and existing searching/filtering behavior remains available

#### Scenario: A member closes mobile search

- **WHEN** a member presses Escape in mobile search and later reopens it
- **THEN** focus returns to the Search icon on close and the query remains intact on reopen

#### Scenario: Desktop discussion controls remain inline

- **WHEN** a member opens Discussion on desktop at 851px or wider
- **THEN** the full Search field, Filters and New post share one row, the search input remains usable, and no obsolete filter column or arrow appears

#### Scenario: Desktop plus opens the composer

- **WHEN** a member activates the desktop New post plus icon
- **THEN** the existing composer opens and the button is44px with accessible name New post; deleting/loading disablement and archived saved-draft access remain unchanged

#### Scenario: Mobile search open state is explicit

- **WHEN** a member opens Search with an empty or populated query
- **THEN** its green border and aria-expanded true identify the open field, input/Clear interactions keep it open, and outside dismissal hides it/removes the border while retaining query and outside focus; reopening restores the border and query
