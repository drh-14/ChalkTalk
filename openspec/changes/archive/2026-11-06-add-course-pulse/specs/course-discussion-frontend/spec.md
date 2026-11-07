## ADDED Requirements

### Requirement: The feed loads more posts as the reader scrolls

When the loaded feed has a further cursor page, the browser SHALL request it automatically once the reader scrolls within about 300 pixels of the end of the post list, without requiring a Load more click. It SHALL observe the post list's own scroll region on wide screens and the page on narrow screens. It SHALL not request a page while one is loading, after a failed page until retry, or while the first page is loading. The Load more button SHALL remain available as a keyboard and fallback control, and the same rules SHALL apply to staff duplicate review.

#### Scenario: A member reaches the end of the loaded posts

- **WHEN** a member scrolls to the bottom of a feed with 25 loaded posts and a next cursor
- **THEN** the next page is requested once and its cards are appended below the existing ones

#### Scenario: A later page fails

- **WHEN** an automatic later-page request fails
- **THEN** no further automatic request is sent and the retry control remains available

### Requirement: The feed status row confirms when everything is read

When the loaded feed has posts and none of them other than the open post is unread, the feed status row SHALL show a check mark with **All caught up** instead of the unread count. It SHALL use the row's existing stable height.

#### Scenario: Every loaded post is read

- **WHEN** a member opens a course whose loaded posts are all read
- **THEN** the status row above the list shows All caught up and no Mark all read control

### Requirement: Loading states hold the page layout

While course data loads, the browser SHALL show placeholders in the place and shape of the content they stand for, so content does not move when it arrives:

- the feed SHALL show placeholder post cards, and an opening post SHALL show placeholders for its kind, title, byline, actions, and body;
- answer areas and followups SHALL show placeholder lines inside their already-drawn sections;
- Course pulse SHALL show its tiles, heatmap grid, weekly chart, topics, and helpers frames with their real titles and placeholder values;
- other course pages SHALL show one loading message where their content will appear, below the page heading, never centered in the window or above content that is already shown.

The course header SHALL show a placeholder for the course name, and the course tabs and staff-only controls SHALL appear together once both the course and the viewer's role are known, so tabs do not shift and staff-only entries do not appear later. Placeholders and loading messages SHALL become visible only after about 150 milliseconds, so fast loads show no placeholder. Each placeholder SHALL announce what is loading to assistive technology while its shapes stay hidden from it. Shimmer and fade-in animation SHALL be disabled when the viewer prefers reduced motion.

#### Scenario: A slow feed

- **WHEN** the first feed page takes a second to load
- **THEN** placeholder post cards appear in the list, the status announces "Loading posts…", and the cards replace them without moving the search row or sidebar

#### Scenario: A fast load

- **WHEN** a page's data arrives within 150 milliseconds
- **THEN** no placeholder or loading message becomes visible

#### Scenario: A staff member reloads the discussion

- **WHEN** a TA reloads a course page
- **THEN** the course tabs, Statistics tab, and the Duplicates entry appear together with the course name, and nothing in the header or sidebar shifts afterward

### Requirement: The course header stays in view

On screens wider than 700px, the course header SHALL stay at the top of the window while the page scrolls, and in-page anchor targets SHALL scroll into view below it.

#### Scenario: A member scrolls a long settings page

- **WHEN** a member scrolls course settings on a wide screen
- **THEN** the course header and tabs remain visible at the top

### Requirement: The filter sidebar collapses behind a pull tab

On screens wider than 850px, a round button on the boundary between the filter sidebar and the post list SHALL collapse and expand the sidebar, exposing its state with `aria-expanded`. When collapsed, half of the button SHALL remain visible at the left edge as a pull tab, aligned with the search row, so the sidebar can be reopened.

#### Scenario: A member hides the filters

- **WHEN** a member collapses the filter sidebar
- **THEN** the post list widens, the half-round tab remains at the left edge, and activating it reopens the sidebar with the same filters selected

## MODIFIED Requirements

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the discussion route SHALL fill the viewport below the course header with three full-height columns (the feed filter sidebar, the post list, and the post detail pane), separated by single dividers and without enclosing rounded panels. The page itself SHALL not scroll on this route. The left-hand post cards SHALL occupy a visibly scrollable region. The search field and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. The right-hand detail pane SHALL scroll independently of the post list, SHALL keep its accessible name, and SHALL be keyboard-focusable so its content can be scrolled without a pointer. Scrolling either column SHALL not move the other or the filter sidebar. On screens at or below 850px, the cards and the detail pane SHALL use natural page scrolling rather than nested scroll areas.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards move within the post list column while its controls remain available above the list, and the filter sidebar and post detail pane do not move

#### Scenario: A member reads a long post

- **WHEN** a member scrolls a selected post whose content is taller than the desktop window
- **THEN** only the detail pane scrolls, the post list, filter sidebar, and course header stay in place, and the page itself does not scroll

#### Scenario: A keyboard user scrolls the post detail

- **WHEN** a keyboard user moves focus to the desktop post detail pane
- **THEN** the pane is focusable by its accessible name and scrolls with the keyboard

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicates
- **THEN** duplicate review cards use the same keyboard-accessible scroll region

### Requirement: Staff can merge and review duplicate posts

The discussion page SHALL show TAs and instructors a canonical-post selection control for the current post and a **Duplicates** entry, marked as staff-only, at the end of the filter sidebar's Show section. The entry SHALL be a toggle button that exposes whether duplicate review is on; pressing it again, or choosing any Show filter, SHALL return to the posts feed with that filter. While duplicate review is on, no Show filter SHALL be selected. Each staff review card SHALL show only the duplicate's title and “Merged into” followed by a link named for its canonical post, never the post type or retained source body. Selecting the card or its title SHALL be keyboard-accessible and show the retained source in the right pane, where staff see the source body, staff-visible author, tags, canonical target link, and unmerge action. Selecting the card's canonical link SHALL open the canonical post in a new tab and leave the duplicate review unchanged. The merge-as-duplicate control SHALL not appear in this mode. Students SHALL not see these controls. Following an old merged-post route SHALL navigate to the canonical post route.

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

- **WHEN** a TA or instructor turns on Duplicates
- **THEN** the sidebar's sort choices, tag chips, and Match control are disabled, and the Show choices stay enabled with none selected

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
