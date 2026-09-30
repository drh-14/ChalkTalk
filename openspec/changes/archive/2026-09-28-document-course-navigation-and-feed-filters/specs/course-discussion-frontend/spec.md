## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected Discussion, Course resources, and Course settings routes for the same course SHALL render one persistent course header in the app bar. From the start of the bar, it shows the ChalkTalk logo and an "All courses" link followed by the course name, as a breadcrumb; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. Discussion, Course resources, and Course settings tabs SHALL be centered in the bar, in that order, with the account controls at the end. Switching between the three routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active tab SHALL be identifiable visually and to assistive technology. Following a tab, All courses, the logo, or Sign out SHALL ask before discarding an unsent post draft. When the bar is too narrow for one row, the tabs SHALL move to their own centered row; at phone widths, the logo and account controls, the breadcrumb, and the tabs SHALL each take a row without horizontal scrolling. Settings content MAY remain narrower than the discussion content.

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

### Requirement: Live search uses the documented course full-text interface

Search SHALL update after approximately 300 ms without input changes, with no Search button or Enter submission requirement. The browser SHALL trim a nonempty query at its edges, limit it to the API's 500-character `q` maximum, store the applied query as `q` in the URL by replacing the current history entry, and send it to the course posts API with `sort=relevance` unless the member has chosen a different sort for the current applied query. Clearing the input SHALL immediately remove `q` and restore the unfiltered feed. The browser SHALL pass PostgreSQL web-search syntax through without its own parser, preserve API result order, and reset pagination when the applied query changes. Live search SHALL not close a selected post or composer, discard an unsent draft, or trigger draft-discard confirmation. Search controls SHALL describe words, quoted phrases, `OR`, and excluded terms to assistive technology.

#### Scenario: A member types a search

- **WHEN** a member enters `A cutoff` and pauses for approximately 300 ms
- **THEN** the browser requests encoded `q=A cutoff` with `sort=relevance`, replaces the URL query, and displays the posts returned by the API without a Search-button click

#### Scenario: A member sorts search results by newest

- **WHEN** a member with an applied search chooses Newest
- **THEN** the browser requests the same `q` with `sort=newest` and displays the results in the returned order

#### Scenario: A member clears the search

- **WHEN** a member clears a nonempty live search field
- **THEN** the browser immediately removes `q`, resets pagination, and loads the unfiltered feed

#### Scenario: A member searches with a draft open

- **WHEN** a member changes the live search while an unsent post composer or selected post is open
- **THEN** only the left feed and its URL query change; the composer draft or selected post remains available without a discard prompt

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the discussion route SHALL fill the viewport below the course header with three full-height columns (the feed filter sidebar, the post list, and the post detail pane), separated by single dividers and without enclosing rounded panels. The page itself SHALL not scroll on this route. The left-hand post cards and their Load more control SHALL occupy a visibly scrollable region. The Posts/Duplicate posts selector, search field, and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. The right-hand detail pane SHALL scroll independently of the post list, SHALL keep its accessible name, and SHALL be keyboard-focusable so its content can be scrolled without a pointer. Scrolling either column SHALL not move the other or the filter sidebar. On screens at or below 850px, the cards and the detail pane SHALL use natural page scrolling rather than nested scroll areas.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards and Load more move within the post list column while its controls remain available above the list, and the filter sidebar and post detail pane do not move

#### Scenario: A member reads a long post

- **WHEN** a member scrolls a selected post whose content is taller than the desktop window
- **THEN** only the detail pane scrolls, the post list, filter sidebar, and course header stay in place, and the page itself does not scroll

#### Scenario: A keyboard user scrolls the post detail

- **WHEN** a keyboard user moves focus to the desktop post detail pane
- **THEN** the pane is focusable by its accessible name and scrolls with the keyboard

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicate posts
- **THEN** duplicate review cards use the same keyboard-accessible scroll region

## ADDED Requirements

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters", with single-choice filters exposed as pressed and unpressed buttons. The filters SHALL be All posts (the default, with no filter parameter), Questions (`type=question`), Notes (`type=note`), and Unanswered (`answered=false`). It SHALL also offer a Sort by control with these options:

- **Recent activity:** the default when no search is applied; the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter and sort. In staff duplicate review, the filters and sort SHALL be disabled and SHALL not affect review requests. Filter and sort are not stored in the URL. On screens at or below 850px, the filters SHALL appear as a wrapping row of buttons above the feed and SHALL be hidden while a post is selected.

#### Scenario: A member shows unanswered questions

- **WHEN** a member selects Unanswered
- **THEN** the browser requests the course feed with `answered=false`, marks Unanswered as pressed and All posts as not pressed, and replaces the list with the returned questions

#### Scenario: A member loads more filtered posts

- **WHEN** a member loads the next page while a filter is active
- **THEN** the next request carries the cursor together with the same filter and sort

#### Scenario: Best match is offered only while searching

- **WHEN** a member with no applied search opens the sort control
- **THEN** only Recent activity and Newest are offered, and Best match appears and becomes selected once a search is applied

#### Scenario: Staff review duplicates

- **WHEN** a TA or instructor switches the post view to Duplicate posts
- **THEN** the sidebar's filters and sort are disabled

### Requirement: Course resources has a placeholder page

The protected `/courses/{courseId}/resources` route SHALL render inside the shared course frame and show a "Course resources" heading that explains that course files will appear there and that sharing resources is not available yet. It SHALL not request resource data and SHALL use natural page scrolling rather than the full-height discussion layout.

#### Scenario: A member opens Course resources

- **WHEN** a signed-in course member opens `/courses/{courseId}/resources`
- **THEN** the shared course header shows the course name with the Course resources tab active, and the page shows the placeholder heading and explanation
