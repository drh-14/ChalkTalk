## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected Discussion, Course resources, and Course settings routes for the same course SHALL render one persistent course header in the app bar. From the start of the bar, it shows the ChalkTalk logo and an "All courses" link followed by the course name, as a breadcrumb; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. A "Switch course" control SHALL follow the course name. It SHALL load the member's courses only when first opened, mark the current course, link to each course and to All courses, and close on Escape or an outside click. Discussion, Course resources, and Course settings tabs SHALL be centered in the bar, in that order, with the account controls at the end. Switching between the three routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active tab SHALL be identifiable visually and to assistive technology. When the route changes, focus SHALL move to the course heading for screen-reader announcement without a visible focus ring. Following a tab, All courses, the logo, a course in the switcher, or Sign out SHALL ask before discarding an unsent post draft. When the bar is too narrow for one row, the tabs SHALL move to their own centered row; at phone widths, the logo and account controls, the breadcrumb, and the tabs SHALL each take a row without horizontal scrolling, and the switcher list SHALL fit within the screen. Settings content MAY remain narrower than the discussion content.

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

#### Scenario: A member with a draft declines to switch course

- **WHEN** a member with an unsent post draft selects another course in the switcher and declines the discard prompt
- **THEN** the course, route, and draft remain unchanged

### Requirement: Posts show when they were created

Each ordinary feed card, the post detail pane, and the staff duplicate-review detail pane SHALL show the post's server-returned `createdAt` beside the displayed author. The visible text SHALL be relative to the viewer's current time: "just now" under one minute, then English minutes, hours, and days ago, such as "3 hours ago", for up to seven days. Posts older than seven days SHALL show a short English calendar date such as "Sep 20", including the year only when it differs from the current year. Dates and hover text SHALL use the viewer's local time zone. Every displayed time SHALL be a semantic time element whose machine-readable value is the original `createdAt` and whose hover text gives the full local date and time. A `createdAt` in the future SHALL display as "just now". If `createdAt` cannot be parsed as a date, the browser SHALL omit the time rather than show invalid text.

The time SHALL be shown beside "Anonymous" and "Deleted user" without changing the viewer-projected author. In the post detail pane only, when the post's `lastActivityAt` is later than its `createdAt`, the browser SHALL also show that time, prefixed "active", using the same formatting and semantic time element. The browser SHALL not display `updatedAt`, SHALL not show `lastActivityAt` on feed cards, and SHALL not mark any post as edited. Staff duplicate-review cards, related-question suggestions, and deleted-post tombstones SHALL not gain a time.

#### Scenario: A member browses the feed

- **WHEN** a course member views a feed card for a post created three hours earlier
- **THEN** the card shows the author followed by a relative time such as "3 hours ago", and hovering it shows the full local date and time

#### Scenario: A member opens an older post

- **WHEN** a member opens the detail pane for a post created more than seven days earlier
- **THEN** the pane shows a short calendar date beside the author instead of a relative time

#### Scenario: An anonymous post shows its time

- **WHEN** a student views another student's anonymous post
- **THEN** the byline shows "Anonymous" with the creation time and no identifying author information

#### Scenario: A staff member was the last to change a post

- **WHEN** staff pin or merge-review a post after it was created, so its `updatedAt` is later than its `createdAt`
- **THEN** the post still shows no edited or updated indicator

#### Scenario: A post had later activity

- **WHEN** a member opens a post created six hours ago whose last activity was one hour ago
- **THEN** the detail pane shows "6 hours ago" and "active 1 hour ago", and the feed card shows only "6 hours ago"

#### Scenario: Staff review a duplicate

- **WHEN** a TA selects a card in Duplicate posts
- **THEN** the right-hand review pane shows the source's creation time beside its staff-visible author, while the review card itself still shows only the title and merged-into link

### Requirement: Post cards separate type, title, preview, and byline

Each ordinary post card in the feed SHALL show these elements in this order:

- **Header row:** a type badge immediately before the title, with the title's wrapped lines returning to the card's leading edge, and any status pills at the trailing edge.
- **Preview:** a plain-text excerpt limited to two lines.
- **Footer:** the viewer-projected author and the post's creation time together, with an optional type-specific summary at the trailing edge.
- **Tags:** the post's tags as chips, when it has any, below the footer and outside the card's link.

The title SHALL be the most prominent text on the card. The badge's label, icon, and color and the card's statuses SHALL come from the same post type list that generates the sidebar filters. Questions SHALL show Answered or Unanswered from the API's `answered` value. Any pinned post SHALL show Pinned. Notes SHALL show no answer status. A post whose type is not in the list SHALL render with a neutral "Post" badge and no type-specific status instead of failing. The detail pane SHALL label a post's type from the same list and show the post's tag chips below the byline. When no post is selected, its prompt SHALL not name specific post types. Staff duplicate review cards keep their restricted title and merged-into content.

#### Scenario: A member scans an unanswered question

- **WHEN** the feed contains a question whose `answered` value is false
- **THEN** its card shows a Question badge beside the title, an Unanswered pill, a two-line preview, and the author with the creation time

#### Scenario: A member sees a pinned, answered question

- **WHEN** the feed contains a question that is answered and pinned
- **THEN** its card shows both Answered and Pinned pills

#### Scenario: A member sees a note

- **WHEN** the feed contains a note
- **THEN** its card shows a Note badge and no Answered or Unanswered pill

#### Scenario: The API returns a type the frontend does not know

- **WHEN** the feed contains a post whose type is not in the post type list
- **THEN** its card renders with a neutral Post badge and no type-specific status

#### Scenario: A tagged post is listed

- **WHEN** the feed contains a post tagged `midterm`
- **THEN** its card and its detail pane show a `#midterm` chip whose accessible name is "Filter by tag midterm"

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters", with single-choice filters exposed as pressed and unpressed buttons. All posts SHALL come first and be the default, with no filter parameter. Three filters that apply to every type SHALL be nested beneath All posts:

- **My posts:** `authorId` set to the signed-in member; shown only when the signed-in member is known.
- **Instructor posts:** `authorRole=instructor`.
- **TA posts:** `authorRole=ta`.

The remaining filters SHALL be generated from the frontend's list of known post types. Each known type SHALL follow, using that type's list filter, and a filter that applies only to one type SHALL be listed directly beneath that type as a nested filter. For the current types, the order SHALL be:

- **All posts**, then **My posts**, **Instructor posts**, and **TA posts** nested beneath it.
- **Questions** (`type=question`), then nested beneath it:
  - **Answered** (`answered=true`).
  - **Unanswered** (`answered=false`).
  - **Pinned** (`type=question&pinned=true`).
- **Notes** (`type=note`), then **Pinned** (`type=note&pinned=true`) nested beneath it.

Filters that share a visible label SHALL have distinct accessible names, such as "Pinned questions" and "Pinned notes". A type SHALL be added to the list only once the API accepts it as a list filter. The sidebar SHALL also offer a Sort by control with these options:

- **Last updated:** `sort=recent_activity`; the default when no search is applied, and then the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Oldest:** `sort=oldest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

Selecting a tag chip on a card or in the post view SHALL add that tag as a filter alongside the active sidebar filter, sending `tag` with the feed request and showing a removable chip, named "Remove tag filter {tag}", in the sidebar. Selecting a tag SHALL not close the selected post.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter, tag, or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter, tag, and sort. In staff duplicate review, the filters and sort SHALL be disabled and SHALL not affect review requests.

On the course discussion and post routes, the active sidebar filter, tag, and chosen sort SHALL be stored in the URL as `filter`, `tag`, and `sort` query parameters, beside `q`. They SHALL be updated by replacing the current history entry rather than adding one, restored when the page loads or the member navigates Back or Forward, and preserved on post links. Unknown or invalid values SHALL be ignored.

On screens at or below 850px, the filters SHALL appear as a wrapping row of buttons above the feed, with nested filters shown as ordinary buttons, and SHALL be hidden while a post is selected.

#### Scenario: A member sees filters for each post type

- **WHEN** a signed-in member opens the discussion route
- **THEN** the sidebar lists All posts, My posts, Instructor posts, TA posts, Questions, Answered, Unanswered, Pinned, Notes, and Pinned in that order, with All posts pressed

#### Scenario: A member shows unanswered questions

- **WHEN** a member selects Unanswered
- **THEN** the browser requests the course feed with `answered=false`, marks Unanswered as pressed and All posts as not pressed, and replaces the list with the returned questions

#### Scenario: A member shows posts by instructors or TAs

- **WHEN** a member selects Instructor posts, then TA posts
- **THEN** the browser requests the course feed with `authorRole=instructor`, then with `authorRole=ta`

#### Scenario: A member shows pinned notes

- **WHEN** a member selects the Pinned filter beneath Notes
- **THEN** the browser requests the course feed with `type=note` and `pinned=true`, and only that Pinned filter is pressed

#### Scenario: A member sorts oldest first

- **WHEN** a member chooses Oldest
- **THEN** the browser requests the course feed with `sort=oldest`

#### Scenario: A member loads more filtered posts

- **WHEN** a member loads the next page while a filter is active
- **THEN** the next request carries the cursor together with the same filter and sort

#### Scenario: Best match is offered only while searching

- **WHEN** a member with no applied search opens the sort control
- **THEN** only Last updated, Newest, and Oldest are offered, and Best match appears and becomes selected once a search is applied

#### Scenario: Staff review duplicates

- **WHEN** a TA or instructor switches the post view to Duplicate posts
- **THEN** the sidebar's filters and sort are disabled

#### Scenario: A member filters by a tag

- **WHEN** a member selects the `midterm` chip on a card while viewing a post, then removes it from the sidebar
- **THEN** the feed is requested with `tag=midterm` while the post stays open, and then requested again without `tag`

#### Scenario: A member shares a filtered view

- **WHEN** a member selects Unanswered and Newest, then opens a post
- **THEN** the URL reads `?filter=question%3Aunanswered&sort=newest` without new history entries, the post link keeps those parameters, and Unanswered stays pressed

## ADDED Requirements

### Requirement: Staff can pin and unpin a post from the post view

When a TA or instructor views an ordinary post, the post view SHALL show a "Staff actions" group containing the existing Merge as duplicate control and, while the course is active, a Pin or Unpin button reflecting the post's `pinned` state. Activating it SHALL send the documented conditional post update with the post's current ETag and CSRF token, disable itself while pending, and update both the post view and that post's feed row on success. A failed update SHALL show the error and reload the post, so a stale revision is replaced. Students SHALL not see the Staff actions group, and no member SHALL see Pin or Unpin in an archived or deleting course.

#### Scenario: A TA pins a post

- **WHEN** a TA activates Pin on a post at version 3
- **THEN** the browser sends `pinned: true` with `If-Match: "v3"`, the button becomes Unpin, and the post's feed row shows Pinned

#### Scenario: A pin races another update

- **WHEN** the pin request returns `412 version_conflict`
- **THEN** the browser shows the error message and reloads the post

#### Scenario: A student views a post

- **WHEN** a student opens a post
- **THEN** no Staff actions group or Pin control appears
