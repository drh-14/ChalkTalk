# course-discussion-frontend Specification

## Purpose

Define the browser experience for course-scoped question and note discussions, including search, creation, related-question suggestions, shareable detail, identity-safe display, and access to course settings.

## Requirements

### Requirement: Course members can browse a discussion-first post feed

The protected `/courses/{courseId}` route SHALL show question and note post cards in a left-hand feed with title and plain-text body excerpt, with post detail beside the feed on wide screens. The feed SHALL preserve API order and show loading, empty, error, and retry states. Existing member and course-management controls SHALL remain available from a clearly labeled `/courses/{courseId}/settings` route. On narrow screens, feed and selected detail SHALL remain navigable without relying on hover.

#### Scenario: A member opens a course with posts

- **WHEN** a signed-in course member opens the course discussion route
- **THEN** the browser lists server-returned post cards in server order and provides an accessible Create post control above them

#### Scenario: A member opens Course settings

- **WHEN** a member follows the Course settings navigation
- **THEN** the existing roster and role-appropriate course actions remain reachable

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

### Requirement: Post detail is shareable and viewer-safe

The browser SHALL support `/courses/{courseId}/posts/{postId}` as a direct link, fetch the post independently of the current feed page, and display the API's viewer-projected author. It SHALL render Markdown without raw HTML execution or unsafe links. A tombstone SHALL show a deleted state without old content; an absent, hidden, or wrong-course result SHALL show an unavailable state without stale identity or body content. Browser Back/Forward SHALL restore selection and the current URL-backed search query without adding a history entry for every live query edit.

#### Scenario: A member opens a post directly

- **WHEN** a member loads a post URL whose post is not in the first feed page
- **THEN** the browser fetches and displays that post without requiring a card to be loaded first

#### Scenario: A selected post is deleted or hidden

- **WHEN** detail retrieval returns a tombstone or `404`
- **THEN** the browser displays the appropriate deleted or unavailable state and does not retain the previous post's content or author

### Requirement: Pagination is isolated to the current course and query

The feed SHALL append subsequent cursor pages without duplicate cards and SHALL not mix pages or stale responses from another course or applied live query. A later-page failure SHALL retain previously visible cards and allow a retry using the same cursor. Loading and retry controls SHALL prevent duplicate concurrent page requests. A new applied live query SHALL clear the old page and cursor before showing its results.

#### Scenario: A later page fails and is retried

- **WHEN** loading more posts fails after an initial page succeeded
- **THEN** the first page remains visible and a retry can load the next page without duplicate cards

#### Scenario: An old search response arrives late

- **WHEN** a previous query resolves after a newer live query
- **THEN** the old response does not replace or append to the newer query's results

### Requirement: A member can create a question or note

The accessible create control SHALL open a composer for type, title, Markdown body, anonymity, and optional tags. The browser SHALL require a trimmed nonempty title of at most 200 characters and a trimmed nonempty body of at most 100,000 characters, matching the existing API limits. It SHALL submit JSON with credentials, CSRF token, and an idempotency key, disable repeat submission while pending, preserve the draft on failure, and navigate to the server-returned post on success. It SHALL reuse a key only for a retry of the same payload. Creation SHALL not be enabled for an archived or deleting course.

#### Scenario: A member creates a question

- **WHEN** a member submits a valid question from the course page
- **THEN** the browser sends the documented create request and opens the created post using the ID returned by the server

#### Scenario: Creation fails

- **WHEN** the API rejects a create request
- **THEN** the browser shows the error, retains the entered draft, and permits a deliberate retry without duplicate submission

#### Scenario: The draft exceeds a documented limit

- **WHEN** a member enters a title longer than 200 characters or a body longer than 100,000 characters
- **THEN** the composer identifies the invalid field and does not send a create request

### Requirement: Question drafts offer bounded related-question suggestions

While a question is being composed, changes to either its title or body SHALL trigger a debounced search after approximately 300 ms. The browser SHALL use the existing course-scoped posts list endpoint with `type=question`, `sort=relevance`, and `limit=10`, and SHALL display at most ten server-returned questions in a scrollable Related questions panel below the draft. Its generated `q` SHALL include every distinct searchable word from the full title, plus up to four distinct recent body words, as an `OR`-joined candidate query no longer than the API's 500-character limit. Searchable words are case-normalized Unicode letter/digit tokens of at least two code units; draft punctuation and typed search operators SHALL not become executable search syntax. At least one eligible body word SHALL be included when present. The body SHALL not be sent wholesale. A note draft or a question draft with no eligible query term SHALL not request suggestions. The API's returned relevance order SHALL be preserved; no semantic similarity or title weighting is promised.

The panel SHALL have loading, empty, and error states; superseded responses SHALL not replace newer suggestions. While the question draft has eligible query terms, the panel SHALL remain visible regardless of pointer exit, focus departure, or Escape, and SHALL not have separate close or reopen controls. It MAY disappear when the draft changes to a note, no eligible query terms remain, or the composer closes. A suggestion SHALL link to its shareable post in a new tab with safe link attributes, preserving the unsent draft. Suggestions SHALL never block creation.

#### Scenario: Title and body edits update suggestions

- **WHEN** a member edits the full title and then the body of a question draft
- **THEN** each edit updates the debounced course-scoped question search without exceeding 500 characters of `q`, each request sets `limit=10`, and the panel shows no more than 10 results

#### Scenario: A member inspects a related question

- **WHEN** the member opens a related-question result
- **THEN** the post opens in a new tab and the current draft remains available

#### Scenario: Related questions persist while composing

- **WHEN** a member moves the pointer away, moves focus elsewhere, or presses Escape while a question draft has eligible query terms
- **THEN** the Related questions panel remains visible without a separate close or reopen control

### Requirement: Tests exercise UI behavior and real lexical search

Rendered React interaction tests SHALL cover feed cards, creation and field limits, related-question debounce/query bounds/persistence, live-search debounce/request syntax/URL replacement/clear behavior, pagination/retry, stale-response isolation, and detail states. PostgreSQL-backed HTTP tests SHALL verify that a query `A cutoff` matches a post containing `Cutoffs for the course`, along with a body-only match, quoted phrase match, and excluded-term nonmatch. Tests SHALL not assert a reverse match when the `course` term is absent or substitute a mocked browser search algorithm for database behavior.

#### Scenario: English full-text stemming and stop words apply

- **WHEN** a course member searches for `A cutoff` after a post titled `Cutoffs for the course` exists
- **THEN** the HTTP API includes that post in the search results

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

### Requirement: Settings load and fail inside the shared course frame

On the settings route, course-specific membership and administration data SHALL load within the settings content area while the shared course header remains visible. Loading and error states SHALL be announced accessibly and SHALL provide retry when appropriate. Existing role-based controls and membership behavior SHALL remain available after loading. The transition SHALL remain understandable with reduced-motion preferences and SHALL not require animation.

#### Scenario: Settings data is still loading

- **WHEN** a member navigates to Settings and its data request has not completed
- **THEN** the course header remains visible and only the settings content area shows an accessible loading state

#### Scenario: Settings data fails to load

- **WHEN** the settings data request fails for a recoverable reason
- **THEN** the shared header remains visible and the settings content presents an error and retry control

### Requirement: Staff can merge and review duplicate posts

The discussion page SHALL show TAs and instructors a canonical-post selection control for the current post and a Posts/Duplicate posts selector above the left feed. Each staff review card SHALL show only the duplicate's title and “Merged into” followed by a link named for its canonical post, never the post type or retained source body. Selecting the card or its title SHALL be keyboard-accessible and show the retained source in the right pane, where staff see the source body, staff-visible author, tags, canonical target link, and unmerge action. Selecting the card's canonical link SHALL open the canonical post in a new tab and leave the duplicate review unchanged. The merge-as-duplicate control SHALL not appear in this mode. Students SHALL not see these controls. Following an old merged-post route SHALL navigate to the canonical post route.

#### Scenario: Staff review and unmerge

- **WHEN** a TA selects Duplicate posts and unmerges a source
- **THEN** the restricted review card disappears and the restored source is available in normal posts

#### Scenario: Staff confirm a merge

- **WHEN** a TA selects a different canonical post from course search and confirms
- **THEN** the client sends a conditional merge request and navigates to the canonical post

### Requirement: The post composer provides selection-aware formatting controls

The post-body editor SHALL provide accessible controls for bold, italic, heading, link, bulleted list, numbered list, inline code, inline LaTeX, and block LaTeX above the body field. Bold, italic, inline code, and inline LaTeX SHALL surround selected text with `**`, `*`, backticks, and `$` respectively; with an empty selection they SHALL insert both delimiters and put the caret between them. Activating a control SHALL preserve the intended selection and return focus to the body editor, so subsequent typing occurs at the intended position. Controls SHALL insert syntax rather than toggle or parse existing formatting.

#### Scenario: An author formats selected text

- **WHEN** an author selects `ptr` in the body and activates Bold
- **THEN** the draft contains `**ptr**` at that position, with `ptr` between the bold delimiters and surrounding text unchanged

#### Scenario: An author inserts formatting at the caret

- **WHEN** an author activates Inline math with no selected text and then types `x^2`
- **THEN** the draft contains `$x^2$` at the insertion point, with the typed expression between the math delimiters

#### Scenario: An author inserts inline code or italic text

- **WHEN** an author selects body text and activates Inline code or Italic
- **THEN** only that selection is surrounded by the corresponding Markdown delimiters and remains between them

### Requirement: Line, link, and block controls produce valid source syntax

Heading SHALL prefix the current line, or each selected line, with `### `. Bulleted and numbered list controls SHALL prefix the current line or each selected line with valid Markdown list markers; numbered list markers SHALL increment from `1.` for a multiline selection. Link SHALL insert `[label](url)`, using selected text as `label` and placing the caret in `url`, or placing the caret inside an empty label when nothing is selected. Inline math SHALL use `$...$`; Block math SHALL place `$$` on separate lines around selected text or a blank interior line, with the caret inside the block when there is no selection. Line and block actions SHALL not overwrite neighboring text at document boundaries.

#### Scenario: An author formats multiple lines as a list

- **WHEN** an author selects three body lines and activates Numbered list
- **THEN** those lines begin with `1. `, `2. `, and `3. ` respectively, without altering unselected neighboring lines

#### Scenario: An author adds a link

- **WHEN** an author selects `notes` and activates Link
- **THEN** the draft contains `[notes](url)` and the caret is in the destination field

#### Scenario: An author adds display math

- **WHEN** an author selects an equation and activates Block math
- **THEN** the equation is between standalone `$$` delimiter lines and adjacent prose remains outside the math block

### Requirement: The composer previews the unsent formatted body

The composer SHALL offer Write and read-only Preview modes for the current body draft. Preview SHALL render the same supported Markdown and LaTeX as published post detail without changing the draft, other form fields, or the pending create request. Switching back to Write SHALL restore an editable body and preserve the intended caret or selection. Publishing SHALL submit the raw `bodyMarkdown` source through the existing creation flow; a failed request SHALL retain the formatted draft.

#### Scenario: An author checks a formula before publishing

- **WHEN** an author enters Markdown and `$x^2$`, switches to Preview, and returns to Write
- **THEN** Preview displays the formatted content and the source text and unsent form fields remain unchanged

#### Scenario: A formatted post fails to publish

- **WHEN** the create-post request fails after formatting was inserted
- **THEN** the composer retains the raw formatted body for a deliberate retry

### Requirement: Completed LaTeX errors are marked as the author types

After every body text edit, the editor SHALL parse the current Markdown and math source and validate each complete inline or block LaTeX expression. It SHALL place a red underline on the source range of any complete expression rejected by the LaTeX renderer, without changing the source or blocking publication. A diagnostic SHALL include concise text that keyboard and assistive-technology users can discover without relying on color or repeated alerts. Unclosed math delimiters SHALL remain neutral while typing; ordinary Markdown syntax that renders as literal text SHALL not be labeled erroneous. Escaped dollar signs and dollar signs inside code SHALL not be treated as math. When an expression is corrected or removed, its underline SHALL disappear in response to that edit, without waiting for a pause or explicit validation action. Older diagnostic results SHALL not replace results for newer text, and checking SHALL not prevent responsive editing of bodies within the existing length limit.

#### Scenario: An author completes an invalid inline expression

- **WHEN** an author types a closing `$` around LaTeX that the renderer rejects
- **THEN** the completed expression receives a red underline and a readable diagnostic after that edit

#### Scenario: An author corrects an expression

- **WHEN** the author changes a rejected expression into valid LaTeX or deletes it
- **THEN** the underline is removed in response to that edit without waiting for an idle timeout

#### Scenario: An author is still typing math

- **WHEN** an author has opened but not closed an inline or block math expression
- **THEN** the unfinished expression has no error underline

#### Scenario: Markdown and escaped syntax remain ordinary text

- **WHEN** a draft contains unmatched Markdown markers, escaped dollar signs, or dollars inside a code span
- **THEN** the editor does not invent LaTeX diagnostics for those ranges

### Requirement: Post bodies render Markdown and LaTeX consistently and safely

Composer Preview, ordinary post detail, staff duplicate review, feed cards, and Related questions SHALL use the same supported Markdown and LaTeX behavior, including `$...$` inline math and standalone `$$` display math. User-authored raw HTML, unsafe links, and untrusted LaTeX commands SHALL not execute or load external resources. Malformed or unsupported LaTeX SHALL leave readable content without blanking the entire post. Cards within the feed SHALL have equal compact fixed heights, and cards within Related questions SHALL have equal compact fixed heights, with long previews contained inside each card. Author-supplied links inside those previews SHALL display their labels without creating nested navigation targets, and images SHALL display their alt text without loading the image; activating the card SHALL navigate to the post.

#### Scenario: A member scans formatted post previews

- **WHEN** a feed card or Related questions item contains `**cutoff**`, `$x^2$`, a Markdown link, and an image
- **THEN** the preview displays bold text and rendered math, the link label appears as inert text inside a single card navigation link, and the image alt text appears without fetching the image

#### Scenario: Preview cards contain varied post lengths

- **WHEN** a feed or Related questions list includes short and long post bodies
- **THEN** cards in that list have equal compact heights, long content stays inside its card, and the full body is available in post detail

#### Scenario: A member reads a post containing formatted text and math

- **WHEN** a post body contains `**cutoff**`, `$x^2$`, and a standalone `$$` display expression
- **THEN** the full post displays bold text, inline math, and display math while retaining the same source text in storage

#### Scenario: Staff review a retained duplicate body

- **WHEN** a staff member opens a duplicate whose retained body contains Markdown and LaTeX
- **THEN** that body renders with the same formatting and safety behavior as ordinary post detail

#### Scenario: A post contains hostile or malformed formatting

- **WHEN** a post body contains raw HTML, an unsafe link, or malformed LaTeX
- **THEN** no author-supplied script or unsafe resource executes, the malformed expression remains readable, and the rest of the post remains visible

### Requirement: Valid math renders inside the editable post body without changing source

The post-body editor SHALL render complete valid `$...$` inline expressions and standalone multiline `$$` expressions inside the editable text box when the caret and selection do not touch their source ranges. The underlying editor document and submitted `bodyMarkdown` SHALL remain the exact raw Markdown. The same untrusted KaTeX policy used in Preview SHALL apply. Escaped dollars and math-looking text inside code SHALL not render as math.

#### Scenario: An author types valid math

- **WHEN** an author completes `$x^2$` or a standalone `$$` block and moves the caret outside its source range
- **THEN** the editor shows the formula as rendered math while preserving the exact source for submission, clipboard, and undo

#### Scenario: An author writes escaped or code text

- **WHEN** dollar signs are escaped or inside Markdown code
- **THEN** those characters remain source text and do not become rendered formula widgets

### Requirement: Editing a formula reveals its exact source

The editor SHALL show the raw delimiters and TeX whenever the caret touches either boundary or is inside a complete formula, whenever a selection intersects one, or when the author activates its rendered formula by pointer. It SHALL restore rendering after the caret leaves and the expression remains valid. Keyboard movement, replacement, toolbar insertion, copy/paste, undo/redo, and IME composition SHALL operate on the raw document; formula replacement ranges SHALL not be atomic. Clicking a widget SHALL reveal and focus its source for editing.

#### Scenario: An author edits rendered inline math

- **WHEN** the author moves the caret into or clicks a rendered `$x^2$` expression
- **THEN** the editor reveals `$x^2$` as editable source and does not alter the stored text

#### Scenario: A selection overlaps display math

- **WHEN** a selection intersects a rendered `$$` expression
- **THEN** its source is visible so the selection can be copied or replaced as raw Markdown

### Requirement: Invalid and unfinished math remains editable source

Invalid complete LaTeX SHALL remain source with its existing red underline and accessible diagnostic. Unfinished math SHALL remain source without an invented error. Results from prior document versions SHALL not render over newer edits. If analysis, worker delivery, or formula rendering fails, the author SHALL still be able to edit and submit raw text.

#### Scenario: A complete expression becomes invalid and is corrected

- **WHEN** an author changes valid math to rejected TeX and later fixes it
- **THEN** rendering gives way to visible underlined source while invalid, then returns after a valid result and the caret leaves

#### Scenario: The worker fails

- **WHEN** formula analysis is unavailable
- **THEN** raw text remains editable, and no stale formula covers it

### Requirement: Posts are listed as flat rows and read at full width

Post cards in the left-hand list, including staff duplicate review cards, SHALL appear as full-width rows separated by dividers rather than individually bordered, rounded boxes. The selected row SHALL be distinguished by a tinted background and a leading accent bar in addition to its existing current-item state, so selection is not conveyed by color alone. Hover and keyboard focus SHALL remain visible on every row. In the detail pane, post content and the post composer SHALL use the full width of the pane, apart from its padding. The home page and course settings route SHALL keep their existing presentation.

#### Scenario: A member selects a post

- **WHEN** a member selects a post in the desktop list
- **THEN** its row shows the tinted background and accent bar, is marked as the current item, and the other rows show no selection

#### Scenario: A member reads on a wide screen

- **WHEN** a member opens a post on a wide screen
- **THEN** the post text spans the full width of the detail pane rather than a narrower column

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters", with a single-choice dropdown named "Show". All posts SHALL come first and be the default, with no filter parameter. The dropdown SHALL offer these author filters:

- **My posts:** `authorId` set to the signed-in member; shown only when the signed-in member is known.
- **Instructor posts:** `authorRole=instructor`.
- **TA posts:** `authorRole=ta`.

The remaining choices SHALL be generated from the frontend's list of known post types. For the current types, the order SHALL be:

- **All posts**, **My posts** when signed in, **Instructor posts**, and **TA posts**.
- **Questions** (`type=question`).
- **Notes** (`type=note`).

A type SHALL be added to the list only once the API accepts it as a list filter. The sidebar SHALL also offer a Sort by control with these options:

- **Last updated:** `sort=recent_activity`; the default when no search is applied, and then the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Oldest:** `sort=oldest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

Selecting a tag chip on a card or in the post view SHALL add that tag as a filter alongside the active sidebar filter, sending `tag` with the feed request and showing a removable chip, named "Remove tag filter {tag}", in the sidebar. Selecting a tag SHALL not close the selected post.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter, tag, or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter, tag, and sort. In staff duplicate review, the filters and sort SHALL be disabled and SHALL not affect review requests.

On the course discussion and post routes, the active sidebar filter, tag, and chosen sort SHALL be stored in the URL as `filter`, `tag`, and `sort` query parameters, beside `q`. They SHALL be updated by replacing the current history entry rather than adding one, restored when the page loads or the member navigates Back or Forward, and preserved on post links. Unknown or invalid values SHALL be ignored.

On screens at or below 850px, the Show and Sort by dropdowns SHALL appear above the feed and SHALL be hidden while a post is selected.

#### Scenario: A member sees filters for each post type

- **WHEN** a signed-in member opens the discussion route
- **THEN** Show offers All posts, My posts, Instructor posts, TA posts, Questions, and Notes in that order, with All posts selected

#### Scenario: A member shows questions

- **WHEN** a member selects Questions
- **THEN** the browser requests the course feed with `type=question`, selects Questions in Show, and replaces the list with the returned questions

#### Scenario: A member shows posts by instructors or TAs

- **WHEN** a member selects Instructor posts, then TA posts
- **THEN** the browser requests the course feed with `authorRole=instructor`, then with `authorRole=ta`

#### Scenario: A member shows notes

- **WHEN** a member selects Notes
- **THEN** the browser requests the course feed with `type=note` and selects Notes in Show

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

- **WHEN** a TA or instructor switches the post view to Duplicate
- **THEN** the sidebar's filters and sort are disabled

#### Scenario: A member filters by a tag

- **WHEN** a member selects the `midterm` chip on a card while viewing a post, then removes it from the sidebar
- **THEN** the feed is requested with `tag=midterm` while the post stays open, and then requested again without `tag`

#### Scenario: A member shares a filtered view

- **WHEN** a member selects Questions and Newest, then opens a post
- **THEN** the URL reads `?filter=question&sort=newest` without new history entries, the post link keeps those parameters, and Questions stays selected

### Requirement: Course resources has a placeholder page

The protected `/courses/{courseId}/resources` route SHALL render inside the shared course frame and show a "Course resources" heading that explains that course files will appear there and that sharing resources is not available yet. It SHALL not request resource data and SHALL use natural page scrolling rather than the full-height discussion layout.

#### Scenario: A member opens Course resources

- **WHEN** a signed-in course member opens `/courses/{courseId}/resources`
- **THEN** the shared course header shows the course name with the Course resources tab active, and the page shows the placeholder heading and explanation

### Requirement: Question detail shows the students' and instructors' answers

When the detail pane shows an active question, it SHALL show a Students' answer section and an Instructors' answer section below the question, loaded from the documented answers list for that post. Notes, deleted posts, and staff duplicate review SHALL not show answer sections. Each section SHALL show loading, error with retry, and empty states. An existing answer SHALL render its Markdown safely, like post bodies, together with its creation time and its viewer-projected contributors. An anonymous answer whose contributors are hidden SHALL show "Anonymous", and an answer with no visible contributors SHALL show "Deleted user". An endorsed answer SHALL show that it is endorsed.

A member whose role matches an empty section (students for the students' answer; TAs and instructors for the instructors' answer) SHALL be able to write that answer with an optional anonymity choice. The composer SHALL require a trimmed nonempty body of at most 100,000 characters, send the documented create request with CSRF and an idempotency key, prevent duplicate submission while pending, keep the draft on failure, and explain that the answer cannot be edited after posting in this phase. A `409 answer_kind_exists` response SHALL reload the answers instead of showing a second composer. TAs and instructors SHALL be able to endorse an unendorsed answer and to delete an unendorsed answer after confirming, sending the answer's current ETag. Students SHALL not see endorse or delete controls. Answer controls SHALL be unavailable when the course is archived or deleting.

#### Scenario: A student answers an unanswered question

- **WHEN** a student opens a question with no students' answer and submits a valid answer
- **THEN** the browser sends the documented create request and shows the created answer in the Students' answer section without a composer

#### Scenario: Another student posted first

- **WHEN** a student submits an answer but the API returns `409 answer_kind_exists`
- **THEN** the browser reloads the answers and shows the existing students' answer

#### Scenario: A TA endorses an answer

- **WHEN** a TA endorses the students' answer
- **THEN** the browser sends a conditional endorsement request and the section shows the answer as endorsed without endorse or delete controls

#### Scenario: A student views a note

- **WHEN** a student opens a note
- **THEN** no answer sections or answer composers appear

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
