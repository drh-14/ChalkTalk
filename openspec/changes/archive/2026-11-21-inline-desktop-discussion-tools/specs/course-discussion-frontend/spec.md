## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected course routes for the same course SHALL render one persistent course header in the app bar. On desktop, the breadcrumb retains the ChalkTalk logo and course name order; on mobile, the logo shares its row with notifications and avatar and the course name occupies the following row; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. The course name and a chevron SHALL together form one "Switch course" control: activating anywhere on the name opens the switcher. It SHALL load the member's courses only when first opened, mark the current course, link to each course, and close on Escape or an outside click. The All courses button SHALL be removed; the ChalkTalk logo SHALL link to `/home` at every width with the existing draft guard. Course tab placement SHALL follow the [current course navigation](../../../../specs/course-discussion-frontend/spec.md). Switching between course routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active section SHALL be identifiable visually and to assistive technology. Desktop SHALL retain all existing section links inline beside the course identity on the ChalkTalk logo row, compacting header spacing and control presentation as needed without unreadable labels or horizontal overflow. The section dropdown SHALL be mobile-only. On screens 850px or narrower, a compact current-section button SHALL open a dropdown of the same available section links instead of displaying the full tab list. Nested course-resource routes SHALL indicate Course resources and course-session routes SHALL indicate Collaboration. Thread unread counts and existing role visibility SHALL be preserved. The dropdown SHALL close on selection, outside pointer or Escape; Escape SHALL return focus to its trigger. All navigation paths SHALL retain same-document navigation, draft-discard guards and modified-link behavior. When the route changes, focus SHALL move to the course heading for screen-reader announcement without a visible focus ring. Following a tab, the logo, a course in the switcher, or Sign out SHALL ask before discarding an unsent post draft. Desktop navigation SHALL remain on the logo row with every section link visible. At 850px or narrower, the ChalkTalk logo SHALL share its row with notifications and avatar, while the course name/switcher and current-section dropdown share the following row. Controls and switcher lists SHALL fit320px and 390px viewports without horizontal overflow or hidden navigation. The bar SHALL show the member's account as an avatar button that opens a menu with their name and email, Account settings, and Sign out, closing on Escape or an outside click.

#### Scenario: A member opens Course settings from Discussion

- **WHEN** a signed-in member activates the Course settings tab
- **THEN** the course header remains visible, the URL changes to `/courses/{courseId}/settings` without a document reload, and the settings content replaces the discussion content

#### Scenario: A member returns to Discussion

- **WHEN** a member activates Discussion from Course settings or uses browser Back
- **THEN** the shared header remains, the discussion content returns, and the Discussion tab is active

#### Scenario: A member opens Course resources

- **WHEN** a member activates the Course resources tab
- **THEN** the same header heading remains, the URL changes to `/courses/{courseId}/resources`, and the Course resources tab is active

#### Scenario: A member leaves with an unsent draft

- **WHEN** a member with an unsent post draft follows a tab, the logo, or Sign out and declines the discard prompt
- **THEN** the draft, route, and session remain unchanged

#### Scenario: A member switches course

- **WHEN** a member opens the course switcher and selects another course
- **THEN** the member's courses load only at that point with the current course marked, and the browser navigates to the chosen course

#### Scenario: The switcher lists only courses

- **WHEN** a member opens the course switcher
- **THEN** the panel lists the member's courses and offers no All courses link, while the ChalkTalk logo remains the guarded home link and no All courses button is shown

#### Scenario: A member with a draft declines to switch course

- **WHEN** a member with an unsent post draft selects another course in the switcher and declines the discard prompt
- **THEN** the course, route, and draft remain unchanged

#### Scenario: A member opens the account menu

- **WHEN** a signed-in member activates the avatar in the app bar
- **THEN** a menu shows their name and email with Account settings and Sign out, and Escape or an outside click closes it

#### Scenario: Desktop sections remain on the logo row

- **WHEN** a member opens a course on desktop or resizes the viewport
- **THEN** all existing section links remain visible on the logo row beside the course identity, using compact readable presentation without a desktop dropdown, horizontal overflow or lost keyboard focus

#### Scenario: Compact mobile section navigation

- **WHEN** a member opens a course at 320px or390px and opens the section dropdown
- **THEN** its current section and existing available links/unread count are exposed, the logo links home without an All courses button, notifications/avatar remain reachable, and selecting a link respects draft guards

### Requirement: Mobile discussion tools share a compact toolbar

At 850px or narrower, Search and New post SHALL be icon buttons with accessible names and touch-friendly targets, sharing one row with the text Filters button in that order. Activating Search SHALL reveal and focus a search field below the toolbar without changing existing query/filter semantics. Escape SHALL close the field and return focus to Search; closing and reopening SHALL retain its query. The existing slash shortcut SHALL reveal and focus mobile search. Desktop SHALL retain a full search field with Filters immediately to its right and New post on the same row, with no button wrapping or horizontal overflow. Breakpoint changes SHALL NOT strand focus in hidden controls.

#### Scenario: A member searches on a phone

- **WHEN** a member opens Discussion at320px or390px and activates the Search icon
- **THEN** Search, New post and Filters remain on one row, a labelled search field opens below that row and receives focus, and existing searching/filtering behavior remains available

#### Scenario: A member closes mobile search

- **WHEN** a member presses Escape in mobile search and later reopens it
- **THEN** focus returns to the Search icon on close and the query remains intact on reopen

#### Scenario: Desktop discussion controls remain inline

- **WHEN** a member opens Discussion on desktop at851px or wider
- **THEN** the full Search field, Filters and New post share one row, the search input remains usable, and no obsolete filter column or arrow appears
