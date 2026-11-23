## MODIFIED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected course routes for the same course SHALL render one persistent course header in the app bar. On desktop, the breadcrumb retains the ChalkTalk logo, course name and All courses order; on mobile, All courses shares the logo row and the course name occupies the following row; the course name SHALL be the page's top-level heading, and a course that is not active SHALL also show its status. The course name and a chevron SHALL together form one "Switch course" control: activating anywhere on the name opens the switcher. It SHALL load the member's courses only when first opened, mark the current course, link to each course, and close on Escape or an outside click. It SHALL not repeat the All courses link, which remains available from the breadcrumb at every width. Course tab placement SHALL follow the [current course navigation](../../../../specs/course-discussion-frontend/spec.md). Switching between course routes SHALL use same-document navigation, not reload the application or re-run session restoration. The active section SHALL be identifiable visually and to assistive technology. Desktop section links SHALL share the ChalkTalk logo row when they fit; when the full row cannot fit, a current-section dropdown immediately beside All courses SHALL replace the links without adding a header row. On screens 850px or narrower, a compact current-section button SHALL open a dropdown of the same available section links instead of displaying the full tab list. Nested course-resource routes SHALL indicate Course resources and course-session routes SHALL indicate Collaboration. Thread unread counts and existing role visibility SHALL be preserved. The dropdown SHALL close on selection, outside pointer or Escape; Escape SHALL return focus to its trigger. All navigation paths SHALL retain same-document navigation, draft-discard guards and modified-link behavior. When the route changes, focus SHALL move to the course heading for screen-reader announcement without a visible focus ring. Following a tab, All courses, the logo, a course in the switcher, or Sign out SHALL ask before discarding an unsent post draft. Desktop navigation SHALL remain on the logo row, falling back to the current-section dropdown when the full links do not fit. At 850px or narrower, All courses SHALL share the ChalkTalk logo row with notifications and avatar, while the course name/switcher and current-section dropdown share the following row. Controls and switcher lists SHALL fit320px and 390px viewports without horizontal overflow or hidden navigation. The bar SHALL show the member's account as an avatar button that opens a menu with their name and email, Account settings, and Sign out, closing on Escape or an outside click.

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

#### Scenario: Desktop sections remain on the logo row

- **WHEN** a member opens a course on desktop or resizes the viewport
- **THEN** the section links stay on the logo row when they fit, otherwise a current-section dropdown beside All courses exposes the same guarded links without adding a header row or losing keyboard focus

#### Scenario: Compact mobile section navigation

- **WHEN** a member opens a course at 320px or390px and opens the section dropdown
- **THEN** its current section and existing available links/unread count are exposed, All courses is in the logo row, notifications/avatar remain reachable, and selecting a link respects draft guards

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the discussion route SHALL fill the viewport below the course header with two full-height columns (the post list and the post detail pane), separated by single dividers and without enclosing rounded panels. The page itself SHALL not scroll on this route. The left-hand post cards SHALL occupy a visibly scrollable region. The search field and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. The right-hand detail pane SHALL scroll independently of the post list, SHALL keep its accessible name, and SHALL be keyboard-focusable so its content can be scrolled without a pointer. Scrolling either column SHALL not move the other. On screens at or below 850px, the cards and the detail pane SHALL use natural page scrolling rather than nested scroll areas.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards move within the post list column while its controls remain available above the list, and the post detail pane do not move

#### Scenario: A member reads a long post

- **WHEN** a member scrolls a selected post whose content is taller than the desktop window
- **THEN** only the detail pane scrolls, the post list and course header stay in place, and the page itself does not scroll

#### Scenario: A keyboard user scrolls the post detail

- **WHEN** a keyboard user moves focus to the desktop post detail pane
- **THEN** the pane is focusable by its accessible name and scrolls with the keyboard

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicates
- **THEN** duplicate review cards use the same keyboard-accessible scroll region

### Requirement: Staff can merge and review duplicate posts

The discussion page SHALL show TAs and instructors a canonical-post selection control for the current post and a **Duplicates** entry, marked as staff-only, at the end of the filter overlay's Show section. The entry SHALL be a toggle button that exposes whether duplicate review is on; pressing it again, or choosing any Show filter, SHALL return to the posts feed with that filter. While duplicate review is on, no Show filter SHALL be selected. Each staff review card SHALL show only the duplicate's title and “Merged into” followed by a link named for its canonical post, never the post type or retained source body. Selecting the card or its title SHALL be keyboard-accessible and show the retained source in the right pane, where staff see the source body, staff-visible author, tags, canonical target link, and unmerge action. Selecting the card's canonical link SHALL open the canonical post in a new tab and leave the duplicate review unchanged. The merge-as-duplicate control SHALL not appear in this mode. Students SHALL not see these controls. Following an old merged-post route SHALL navigate to the canonical post route.

#### Scenario: Staff review and unmerge

- **WHEN** a TA selects Duplicates and unmerges a source
- **THEN** the restricted review card disappears and the restored source is available in normal posts

#### Scenario: Staff confirm a merge

- **WHEN** a TA selects a different canonical post from course search and confirms
- **THEN** the client sends a conditional merge request and navigates to the canonical post

#### Scenario: Staff leave duplicate review from the sidebar

- **WHEN** a TA reviewing duplicates chooses Questions in the Show section
- **THEN** the feed returns to posts filtered to questions and Duplicates is no longer pressed

### Requirement: Members can filter and sort the course feed

The discussion route SHALL offer a labelled nonmodal dialog named "Post filters", opened by Filters as specified below. It SHALL contain a Show section and a Sort by section, each built as an accordion section.

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

Selecting a tag chip on a card or in the post view SHALL add that tag to the active tags, alongside the active filter. Selecting a chip whose tag is already active SHALL remove it. Selecting a tag SHALL not close the selected post.

While any tag is active, the filter overlay SHALL show a Tags section listing each active tag as a removable chip, named "Remove tag filter {tag}", with a Clear all control that removes every active tag. At most 10 tags SHALL be active at once. Selecting an inactive chip while 10 tags are active SHALL leave the tags and feed unchanged and SHALL announce that at most 10 tags can be combined.

The feed request SHALL send each active tag as a repeated `tag` parameter. While two or more tags are active, the Tags section SHALL show a Match control with Any and All choices. All SHALL be the default and send `tagMatch=all`, returning posts that carry every active tag. Any SHALL send `tagMatch=any`, returning posts that carry at least one active tag. With fewer than two active tags, the browser SHALL omit `tagMatch`.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter, tags, tag match, or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter, tags, tag match, and sort. In staff duplicate review, the filter and sort choices, tag chips, and Match control SHALL be disabled and SHALL not affect review requests; the section headers MAY still open and close.

On the course discussion and post routes, the active filter, tags, tag match, and chosen sort SHALL be stored in the URL beside `q`: `filter`, one `tag` parameter per active tag in the order they were added, `tagMatch=any` only when Any is chosen with two or more tags, and `sort`. They SHALL be updated by replacing the current history entry rather than adding one, restored when the page loads or the member navigates Back or Forward, and preserved on post links. Unknown or invalid values SHALL be ignored. Tags beyond the first 10 distinct values SHALL be ignored.

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

- **WHEN** a TA or instructor turns on Duplicates
- **THEN** the filter overlay's sort choices, tag chips, and Match control are disabled, and the Show choices stay enabled with none selected

#### Scenario: A member filters by a tag

- **WHEN** a member selects the `midterm` chip on a card while viewing a post, then removes it from the filter overlay
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

### Requirement: Post cards separate type, title, preview, and byline

Each ordinary post card in the feed SHALL show these elements in this order:

- **Header row:** a type badge inline immediately before the title, the title wrapping to at most two lines that return to the card's leading edge and end in an ellipsis when cut, and any status pills at the trailing edge.
- **Preview:** a compact rendered Markdown and LaTeX excerpt whose paragraphs run together as text, limited to two lines and ending in an ellipsis when cut.
- **Footer:** the viewer-projected author and the post's creation time together, with an optional type-specific summary at the trailing edge.
- **Tags:** the post's tags as chips, when it has any, below the footer and outside the card's link, starting at the same leading edge as the card's text.

The title SHALL be the most prominent text on the card. The badge's label, icon, and color and the card's statuses SHALL come from the same post type list that generates the filter overlay filters. Questions SHALL show Answered or Unanswered from the API's `answered` value. Any pinned post SHALL show Pinned. Notes SHALL show no answer status. A post whose type is not in the list SHALL render with a neutral "Post" badge and no type-specific status instead of failing. The detail pane SHALL label a post's type from the same list and show the post's tag chips below the byline. When no post is selected, its prompt SHALL not name specific post types. Staff duplicate review cards keep their restricted title and merged-into content.

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

#### Scenario: A long title and multi-paragraph body are listed

- **WHEN** the feed contains a post whose title and body are longer than the card
- **THEN** the badge sits on the title's first line, the title ends in an ellipsis within two lines, the preview joins the paragraphs and ends in an ellipsis within two lines, and the tag chips line up with the title

### Requirement: Loading states hold the page layout

While course data loads, the browser SHALL show placeholders in the place and shape of the content they stand for, so content does not move when it arrives:

- the feed SHALL show placeholder post cards, and an opening post SHALL show placeholders for its kind, title, byline, actions, and body;
- answer areas and followups SHALL show placeholder lines inside their already-drawn sections;
- Course pulse SHALL show its tiles, heatmap grid, weekly chart, topics, and helpers frames with their real titles and placeholder values;
- other course pages SHALL show one loading message where their content will appear, below the page heading, never centered in the window or above content that is already shown.

The course header SHALL show a placeholder for the course name, and the course tabs and staff-only controls SHALL appear together once both the course and the viewer's role are known, so tabs do not shift and staff-only entries do not appear later. Placeholders and loading messages SHALL become visible only after about 150 milliseconds, so fast loads show no placeholder. Each placeholder SHALL announce what is loading to assistive technology while its shapes stay hidden from it. Shimmer and fade-in animation SHALL be disabled when the viewer prefers reduced motion.

#### Scenario: A slow feed

- **WHEN** the first feed page takes a second to load
- **THEN** placeholder post cards appear in the list, the status announces "Loading posts…", and the cards replace them without moving the search row or filter overlay

#### Scenario: A fast load

- **WHEN** a page's data arrives within 150 milliseconds
- **THEN** no placeholder or loading message becomes visible

#### Scenario: A staff member reloads the discussion

- **WHEN** a TA reloads a course page
- **THEN** the course tabs, Statistics tab, and the Duplicates entry appear together with the course name, and nothing in the header or overlay shifts afterward

## REMOVED Requirements

### Requirement: The filter sidebar collapses behind a pull tab

**Reason**: Superseded by the approved overlay, with no permanent sidebar or mobile panel.
**Migration**: Use Filters beside Search; active selections remain.

### Requirement: Members can resize course filters across screen sizes

**Reason**: Overlay replaces all custom resizing and handles.
**Migration**: Overlay automatically fits the viewport and scrolls internally.

### Requirement: Preferred filter dimensions survive reloads and viewport changes

**Reason**: No adjustable filter dimensions remain.
**Migration**: Ignore saved dimension preferences without deleting unrelated storage or changing filter selections.

## ADDED Requirements

### Requirement: Course filters open as a bounded overlay

The actual current ChalkTalk UI SHALL be the style source of truth. Existing typography, palette, spacing conventions, icons, control appearance, content and role visibility SHALL be preserved except for the requested layout/interaction changes. Mockups SHALL NOT introduce alternate styling or invented content.

On desktop, a Filters button immediately right of the full Search field SHALL open a labelled nonmodal filter overlay over the interface without moving or resizing feed/detail content. Filters SHALL start closed on a fresh course discussion mount. The overlay SHALL reuse existing immediate filter, sort, folder, tag and staff-only controls, retaining selected filters/post detail across closing and reopening, without requesting feed data solely for opening or closing. Existing URL/filter persistence SHALL remain unchanged. No left filter column, mobile height panel, collapse strip, resize handle or saved dimension read/write SHALL remain. The overlay SHALL remain inside the viewport with a reachable close header and internally scrollable contents on320px mobile, landscape and desktop, without horizontal page overflow. Opening SHALL focus a usable filter control. Explicit close or Escape SHALL close and return focus to Filters; outside pointer SHALL close without stealing focus from the clicked target. The trigger SHALL expose expanded state and controlled panel identity, and closed contents SHALL not remain keyboard- or assistive-technology reachable.

#### Scenario: Filters overlay does not shift content

- **WHEN** a member opens or closes Filters beside Search on desktop or mobile
- **THEN** the overlay changes visibility, feed/detail geometry remains unchanged, and no layout-only feed request occurs

#### Scenario: Filter changes take effect immediately

- **WHEN** a member selects an existing filter in the overlay and closes then reopens it
- **THEN** the feed applies the existing filter behavior immediately without Apply/Save and the selection is retained

#### Scenario: Small-screen filters remain reachable

- **WHEN** the overlay opens at 320px or after orientation/viewport changes
- **THEN** it remains viewport-bounded, the close control stays reachable and internal scrolling reaches lower folders/tags

#### Scenario: Keyboard and outside dismissal

- **WHEN** a member opens by keyboard and presses Escape or activates Close
- **THEN** the overlay closes and focus returns to Filters; outside pointer dismissal instead preserves the intended clicked target's focus

#### Scenario: Legacy dimensions do not affect overlays

- **WHEN** old desktop/mobile dimension preferences exist or storage is unavailable
- **THEN** overlay sizing follows the viewport, no resize control appears and existing filter interaction remains usable

### Requirement: Mobile discussion tools share a compact toolbar

At 850px or narrower, Search and New post SHALL be icon buttons with accessible names and touch-friendly targets, sharing one row with the text Filters button in that order. Activating Search SHALL reveal and focus a search field below the toolbar without changing existing query/filter semantics. Escape SHALL close the field and return focus to Search; closing and reopening SHALL retain its query. The existing slash shortcut SHALL reveal and focus mobile search. Desktop SHALL retain a full search field with Filters immediately to its right. Breakpoint changes SHALL NOT strand focus in hidden controls.

#### Scenario: A member searches on a phone

- **WHEN** a member opens Discussion at320px or390px and activates the Search icon
- **THEN** Search, New post and Filters remain on one row, a labelled search field opens below that row and receives focus, and existing searching/filtering behavior remains available

#### Scenario: A member closes mobile search

- **WHEN** a member presses Escape in mobile search and later reopens it
- **THEN** focus returns to the Search icon on close and the query remains intact on reopen
