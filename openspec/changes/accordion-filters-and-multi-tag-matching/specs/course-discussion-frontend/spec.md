## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected Discussion, Course resources, and Course settings routes for the same course SHALL render one persistent course header in the app bar. From the start of the bar, it shows the ChalkTalk logo and an "All courses" link followed by the course name, as a breadcrumb; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. A "Switch course" control SHALL follow the course name. It SHALL load the member's courses only when first opened, mark the current course, link to each course, and close on Escape or an outside click. It SHALL not repeat the All courses link, which remains available from the breadcrumb at every width. Discussion, Course resources, and Course settings tabs SHALL be centered in the bar, in that order, with the account controls at the end. Switching between the three routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active tab SHALL be identifiable visually and to assistive technology. When the route changes, focus SHALL move to the course heading for screen-reader announcement without a visible focus ring. Following a tab, All courses, the logo, a course in the switcher, or Sign out SHALL ask before discarding an unsent post draft. When the bar is too narrow for one row, the tabs SHALL move to their own centered row; at phone widths, the logo and account controls, the breadcrumb, and the tabs SHALL each take a row without horizontal scrolling, and the switcher list SHALL fit within the screen. Settings content MAY remain narrower than the discussion content.

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

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters". It SHALL contain a Show section and a Sort by section, each built as an accordion section.

Each section SHALL have a header button named for the section. The button SHALL expose whether its section is expanded and SHALL open or close the section. While a section is closed, its header SHALL show the section name with the current choice, such as "Show · Questions". While open, a section SHALL present its choices as a single-choice group of rows. The selected row SHALL be distinguished by accent-colored bold text and a leading accent bar, so selection is not conveyed by color alone, and SHALL be identified as selected to assistive technology. Section headers SHALL read as section labels, visually distinct from the rows they control. Choosing a row SHALL apply it without closing the section. Opening or closing a section SHALL not change any filter, sort, or tag, or send a feed request.

On screens wider than 850px, both sections SHALL start open. At 850px or less, both SHALL start closed. The starting state SHALL be chosen when the discussion view loads and SHALL not change when the window is later resized. Open or closed state SHALL not be remembered between visits.

All posts SHALL come first in Show and be the default, with no filter parameter. Show SHALL offer these author filters:

- **My posts:** `authorId` set to the signed-in member; shown only when the signed-in member is known.
- **Instructor posts:** `authorRole=instructor`.
- **TA posts:** `authorRole=ta`.

The remaining choices SHALL be generated from the frontend's list of known post types. For the current types, the order SHALL be:

- **All posts**, **My posts** when signed in, **Instructor posts**, and **TA posts**.
- **Questions** (`type=question`).
- **Notes** (`type=note`).

A type SHALL be added to the list only once the API accepts it as a list filter. Sort by SHALL offer these options:

- **Last updated:** `sort=recent_activity`; the default when no search is applied, and then the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Oldest:** `sort=oldest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

Selecting a tag chip on a card or in the post view SHALL add that tag to the active tags, alongside the active sidebar filter. Selecting a chip whose tag is already active SHALL remove it. Selecting a tag SHALL not close the selected post.

While any tag is active, the sidebar SHALL show a Tags section listing each active tag as a removable chip, named "Remove tag filter {tag}", with a Clear all control that removes every active tag. At most 10 tags SHALL be active at once. Selecting an inactive chip while 10 tags are active SHALL leave the tags and feed unchanged and SHALL announce that at most 10 tags can be combined.

The feed request SHALL send each active tag as a repeated `tag` parameter. While two or more tags are active, the Tags section SHALL show a Match control with Any and All choices. All SHALL be the default and send `tagMatch=all`, returning posts that carry every active tag. Any SHALL send `tagMatch=any`, returning posts that carry at least one active tag. With fewer than two active tags, the browser SHALL omit `tagMatch`.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter, tags, tag match, or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter, tags, tag match, and sort. In staff duplicate review, the filter and sort choices, tag chips, and Match control SHALL be disabled and SHALL not affect review requests; the section headers MAY still open and close.

On the course discussion and post routes, the active sidebar filter, tags, tag match, and chosen sort SHALL be stored in the URL beside `q`: `filter`, one `tag` parameter per active tag in the order they were added, `tagMatch=any` only when Any is chosen with two or more tags, and `sort`. They SHALL be updated by replacing the current history entry rather than adding one, restored when the page loads or the member navigates Back or Forward, and preserved on post links. Unknown or invalid values SHALL be ignored. Tags beyond the first 10 distinct values SHALL be ignored.

On screens at or below 850px, the Show and Sort by sections, and the Tags section while any tag is active, SHALL appear above the feed and SHALL be hidden while a post is selected.

#### Scenario: A member sees filters for each post type

- **WHEN** a signed-in member opens the discussion route
- **THEN** Show offers All posts, My posts, Instructor posts, TA posts, Questions, and Notes in that order, with All posts selected

#### Scenario: A member shows questions

- **WHEN** a member selects Questions
- **THEN** the browser requests the course feed with `type=question`, marks Questions as selected in Show, keeps Show open, and replaces the list with the returned questions

#### Scenario: A member shows posts by instructors or TAs

- **WHEN** a member selects Instructor posts, then TA posts
- **THEN** the browser requests the course feed with `authorRole=instructor`, then with `authorRole=ta`

#### Scenario: A member shows notes

- **WHEN** a member selects Notes
- **THEN** the browser requests the course feed with `type=note` and marks Notes as selected in Show

#### Scenario: A member sorts oldest first

- **WHEN** a member chooses Oldest
- **THEN** the browser requests the course feed with `sort=oldest`

#### Scenario: A member closes and reopens a section

- **WHEN** a member on a wide screen closes Show while Questions is selected, then reopens it
- **THEN** the closed header reads "Show · Questions" and is marked collapsed, no feed request is sent, and reopening shows the rows again with Questions still selected

#### Scenario: Sections start closed on a phone

- **WHEN** a member opens the discussion route on a screen 850px wide or less
- **THEN** Show and Sort by appear above the feed with their headers closed and showing "Show · All posts" and "Sort by · Last updated"

#### Scenario: A member loads more filtered posts

- **WHEN** a member loads the next page while a filter is active
- **THEN** the next request carries the cursor together with the same filter and sort

#### Scenario: Best match is offered only while searching

- **WHEN** a member with no applied search opens the Sort by section
- **THEN** only Last updated, Newest, and Oldest are offered, and Best match appears and becomes selected once a search is applied

#### Scenario: Staff review duplicates

- **WHEN** a TA or instructor switches the post view to Duplicate
- **THEN** the sidebar's filter and sort choices, tag chips, and Match control are disabled

#### Scenario: A member filters by a tag

- **WHEN** a member selects the `midterm` chip on a card while viewing a post, then removes it from the sidebar
- **THEN** the feed is requested with `tag=midterm` while the post stays open, and then requested again without `tag`

#### Scenario: A member combines tags

- **WHEN** a member selects the `recursion` chip, then the `exam-2` chip
- **THEN** the feed is requested with `tag=recursion`, then with `tag=recursion&tag=exam-2&tagMatch=all`, the Tags section shows both chips with All selected, and the URL reads `?tag=recursion&tag=exam-2`

#### Scenario: A member matches any tag

- **WHEN** a member with `recursion` and `exam-2` active chooses Any
- **THEN** the feed is requested with `tagMatch=any`, and the URL adds `tagMatch=any`

#### Scenario: A member toggles or clears tags

- **WHEN** a member selects an already active tag chip on a card, and later chooses Clear all
- **THEN** that tag is removed from the feed request and URL, and Clear all removes every remaining tag, `tagMatch`, and the Tags section

#### Scenario: A member reaches the tag limit

- **WHEN** a member with 10 active tags selects another tag chip
- **THEN** the active tags and feed are unchanged and the page announces that at most 10 tags can be combined

#### Scenario: A member shares a filtered view

- **WHEN** a member selects Questions and Newest, then opens a post
- **THEN** the URL reads `?filter=question&sort=newest` without new history entries, the post link keeps those parameters, and Questions stays selected
