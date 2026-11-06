## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected course routes for the same course SHALL render one persistent course header in the app bar. From the start of the bar, it shows the ChalkTalk logo and an "All courses" link followed by the course name, as a breadcrumb; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. The course name and a chevron SHALL together form one "Switch course" control: activating anywhere on the name opens the switcher. It SHALL load the member's courses only when first opened, mark the current course, link to each course, and close on Escape or an outside click. It SHALL not repeat the All courses link, which remains available from the breadcrumb at every width. Course tab placement SHALL follow the [current course navigation](../../../../specs/course-discussion-frontend/spec.md). Switching between course routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active tab SHALL be identifiable visually and to assistive technology. When the route changes, focus SHALL move to the course heading for screen-reader announcement without a visible focus ring. Following a tab, All courses, the logo, a course in the switcher, or Sign out SHALL ask before discarding an unsent post draft. When the bar is too narrow for one row, the tabs SHALL move to their own centered row; at phone widths, the logo and account controls, the breadcrumb, and the tabs SHALL each take a row without horizontal scrolling, and the switcher list SHALL fit within the screen. The bar SHALL show the member's account as an avatar button that opens a menu with their name and email, Account settings, and Sign out, closing on Escape or an outside click.

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

- **WHEN** a member with an unsent post draft follows a tab, All courses, the logo, or Sign out and declines the discard prompt
- **THEN** the draft, route, and session remain unchanged

#### Scenario: A member switches course

- **WHEN** a member opens the course switcher and selects another course
- **THEN** the member's courses load only at that point with the current course marked, and the browser navigates to the chosen course

#### Scenario: The switcher lists only courses

- **WHEN** a member opens the course switcher
- **THEN** the panel lists the member's courses and offers no All courses link, while the breadcrumb's All courses link stays visible

#### Scenario: A member with a draft declines to switch course

- **WHEN** a member with an unsent post draft selects another course in the switcher and declines the discard prompt
- **THEN** the course, route, and draft remain unchanged

#### Scenario: A member opens the account menu

- **WHEN** a signed-in member activates the avatar in the app bar
- **THEN** a menu shows their name and email with Account settings and Sign out, and Escape or an outside click closes it

## ADDED Requirements

### Requirement: Date-sorted feeds group posts into sections

When the feed is sorted by Last updated, Newest, or Oldest, the browser SHALL group the loaded posts into sections in feed order: a leading run of pinned posts as **Pinned**, then **Today**, **Yesterday**, **Earlier this week**, **Last week**, and one section per older Sunday-to-Saturday week labeled `Week of <Mon d> – <Mon d>`, with the year when it differs from the current year. Sections SHALL use last activity for Last updated and creation time otherwise. Each section heading SHALL show its post count, be a button that collapses and expands its posts with `aria-expanded`, and stay visible while its posts scroll. Search results sorted by relevance SHALL remain one list without sections. Loading more posts SHALL extend the sections.

#### Scenario: A member scans a semester of posts

- **WHEN** a member opens a course feed whose posts span several weeks, including pinned posts
- **THEN** the feed shows Pinned first, then date sections from newest to oldest, each with its post count

#### Scenario: A member collapses a week

- **WHEN** a member activates a section heading
- **THEN** that section's posts are hidden and the heading reports collapsed, while other sections remain

#### Scenario: A member searches

- **WHEN** a member searches the feed
- **THEN** results appear in one relevance-ranked list without date sections

### Requirement: Course pages share one page frame

The Threads, Collaboration, Course resources (Course information, Staff, and Resources), Course settings, and Statistics pages SHALL each show a page title and a one-line description in one shared style, with the page's primary action at the trailing edge of the header, inside the shared content width. Card and section titles SHALL share one style. Page-header and row actions SHALL use one compact button size, and form submissions one standard size. When there is nothing to show, the discussion detail (no post or duplicate selected), Threads (no threads), and Collaboration (no sessions) SHALL show an empty state in a card: a decorative illustration hidden from assistive technology, a heading, a short explanation, and any available action.

#### Scenario: A member moves between course tabs

- **WHEN** a member switches between Threads, Collaboration, Course resources, Course settings, and Statistics
- **THEN** each page's title, description, and content start at the same position in the same style

#### Scenario: A course has no threads

- **WHEN** a member opens Threads in a course without threads
- **THEN** an empty state explains what threads are for, and staff in an active course see Create thread in the page header
