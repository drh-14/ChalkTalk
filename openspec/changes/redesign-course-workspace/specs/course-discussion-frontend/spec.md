# Spec Delta

## MODIFIED Requirements

### Requirement: Course members can browse a discussion-first post feed

The protected `/courses/{courseId}` route SHALL show question and note posts as compact list rows in a left-hand feed, with post detail beside the feed on wide screens. Each row SHALL show the post type, title, a single-line plain-text body excerpt, the API's viewer-projected author, a relative creation time with the absolute UTC-derived local time available on hover and to assistive technology, the post's tags, a Pinned badge when `pinned` is true, and an Unanswered badge for questions whose `answered` is false. The feed SHALL preserve API order and show loading, empty, error, and retry states; the empty state SHALL distinguish a course with no posts from filters or a search that match nothing and SHALL offer a control to clear active filters. Existing member and course-management controls SHALL remain available from a clearly labeled `/courses/{courseId}/settings` route. On narrow screens, feed and selected detail SHALL remain navigable without relying on hover.

#### Scenario: A member opens a course with posts

- **WHEN** a signed-in course member opens the course discussion route
- **THEN** the browser lists server-returned posts in server order as compact rows showing type, title, excerpt, author, relative time, and tags, and provides an accessible Create post control above them

#### Scenario: A row shows status badges

- **WHEN** the feed contains a pinned note and an unanswered question
- **THEN** the note's row shows a Pinned badge and the question's row shows an Unanswered badge, each with a text label available to assistive technology

#### Scenario: Filters match nothing

- **WHEN** an applied search or filter returns an empty first page in a course that has posts
- **THEN** the feed states that nothing matches and offers a control that clears the search and filters

#### Scenario: A member opens Course settings

- **WHEN** a member follows the Course settings navigation
- **THEN** the existing roster and role-appropriate course actions remain reachable

### Requirement: Desktop post listings scroll independently

On screens wider than 850px, the course discussion route SHALL fill the viewport below the application top bar without page-level scrolling. The filter rail, the post list, and the reading pane SHALL each scroll independently within that height. The Posts/Duplicate posts selector, search field, and Create post button SHALL remain above the post list's scroll region, and the post rows and their Load more control SHALL occupy that region. The post list region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. The reading pane SHALL extend to the bottom of the viewport regardless of the selected post's length. On screens at or below 850px, content SHALL use natural page scrolling rather than nested scroll areas.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post rows and Load more move within the post list region while the top bar, filter rail, list controls, and reading pane stay in place

#### Scenario: A member reads a long post

- **WHEN** a member scrolls a selected post whose body is taller than the viewport
- **THEN** only the reading pane scrolls and the post list keeps its scroll position

#### Scenario: Staff switch to duplicate posts

- **WHEN** a TA or instructor selects Duplicate posts
- **THEN** duplicate review cards use the same keyboard-accessible scroll region

### Requirement: Course discussion and settings share a stable frame

The protected home, Discussion, and Course settings routes SHALL render a persistent application top bar containing the ChalkTalk wordmark linking to `/home`, a course switcher, the signed-in user's avatar initial, and a Sign out control. On the Discussion and Course settings routes for a course, the top bar SHALL also show that course's name and the Discussion/Course settings navigation. The course switcher SHALL list the courses returned for the signed-in member and navigate to a chosen course's discussion route. Navigation initiated from the top bar SHALL respect the existing unsent-draft discard confirmation. Switching between Discussion and Course settings SHALL use same-document navigation, not reload the application or re-run session restoration. The active navigation item SHALL be identifiable visually and to assistive technology. Settings content MAY remain narrower than the discussion content.

#### Scenario: A member opens Course settings from Discussion

- **WHEN** a signed-in member activates Course settings
- **THEN** the top bar remains visible with the course name, the URL changes to `/courses/{courseId}/settings` without a document reload, and the settings content replaces the discussion content

#### Scenario: A member returns to Discussion

- **WHEN** a member activates Discussion from Course settings or uses browser Back
- **THEN** the top bar remains, the discussion content returns, and the appropriate navigation item is active

#### Scenario: A member switches course with a draft open

- **WHEN** a member with an unsent post draft chooses another course in the course switcher
- **THEN** the browser asks for discard confirmation before leaving, and stays on the current course with the draft intact if the member declines

## ADDED Requirements

### Requirement: The feed offers URL-backed filters using implemented list parameters

The discussion route SHALL offer filters for All posts, Questions, Notes, and Unanswered, a sort choice of Recent activity or Newest, and a single active tag filter. Selecting a tag shown on a post row or in post detail SHALL apply that tag filter; the active tag SHALL be visible with a control to remove it. The browser SHALL map these to the documented course posts list parameters `type=question`, `type=note`, `answered=false`, `sort=recent_activity`, `sort=newest`, and `tag`, and SHALL send no filter parameter for All posts. While a search query is applied, results SHALL use relevance order and the sort choice SHALL indicate that relevance is in effect. Filters SHALL combine with an applied search. The applied filter, tag, and sort SHALL be stored in the URL by replacing the current history entry, SHALL be restored from a loaded URL, and SHALL be preserved when a post is selected. Changing any filter SHALL reset pagination and SHALL not let a response for a previous filter replace or append to the current results. Filter changes SHALL not close a selected post or composer or discard an unsent draft. Filter controls SHALL be operable by keyboard and expose their selected state to assistive technology. Staff Duplicate posts mode SHALL not apply these filters.

#### Scenario: A member shows unanswered questions

- **WHEN** a member selects Unanswered
- **THEN** the browser requests the course posts list with `answered=false`, shows the returned posts, and the URL records the filter

#### Scenario: A member filters by a tag on a post

- **WHEN** a member selects the tag `midterm` on a post row
- **THEN** the browser requests the course posts list with `tag=midterm`, shows an active `midterm` filter with a remove control, and the selected post remains open

#### Scenario: A filtered URL is opened directly

- **WHEN** a member loads `/courses/{courseId}?type=note&sort=newest`
- **THEN** the Notes filter and Newest sort are selected and the first request uses `type=note` and `sort=newest`

#### Scenario: A filter response arrives late

- **WHEN** a response for a previous filter resolves after a newer filter was applied
- **THEN** that response does not replace or append to the newer filter's results

### Requirement: Post detail presents a structured reading pane

The reading pane SHALL present a selected active post as a header containing type, title, viewer-projected author, creation time, last-activity time when it differs, tags, and Pinned and Unanswered badges, followed by the rendered Markdown body. Staff-only actions SHALL appear together in an action bar that does not span the full pane width. The pane SHALL reserve a distinct region after the body for later discussion content without rendering placeholder answers or controls that do not function. With no post selected on a wide screen, the pane SHALL show a compact prompt to choose a post or create one. Tombstone and unavailable states SHALL continue to follow the shareable-detail requirement.

#### Scenario: A member opens a question

- **WHEN** a member selects an active question
- **THEN** the pane shows its type, title, projected author, creation time, tags, badges, and rendered body, and shows no answer composer or placeholder answers

#### Scenario: A student opens a post

- **WHEN** a student selects a post
- **THEN** no staff action bar is shown

### Requirement: Staff can pin and unpin posts from detail

TAs and instructors SHALL see a Pin control on an unpinned active post and an Unpin control on a pinned active post in the staff action bar. Activating it SHALL send the documented conditional post update with `If-Match` set to the post's current ETag, the CSRF token, and only the `pinned` field. While pending, the control SHALL be disabled. On success, the detail and any visible row for that post SHALL reflect the returned pinned state. On a stale-revision or other failure, the browser SHALL show the error, keep the previous state, and refresh the post so a deliberate retry uses the current revision. Students SHALL not see the control. Pinning SHALL not be offered for archived or deleting courses.

#### Scenario: A TA pins a post

- **WHEN** a TA activates Pin on an unpinned post
- **THEN** the browser sends a conditional update containing `pinned: true`, and on success the pane and the post's row show the Pinned badge

#### Scenario: A pin conflicts with a newer revision

- **WHEN** the pin request fails because the post changed since it was loaded
- **THEN** the browser shows an error, leaves the pinned state unchanged, and reloads the post so a retry uses its current ETag

### Requirement: Narrow screens present list and detail as separate views

On screens at or below 850px, the discussion route SHALL show either the post list or the selected post at full width, never both side by side. Selecting a post SHALL show its detail with a Back to posts control that returns to the list with the prior search, filters, and scroll position. Filters SHALL appear as a single horizontally scrollable row of controls above the list. No protected route SHALL cause horizontal page scrolling at viewport widths of 320px or more.

#### Scenario: A member opens a post on a phone

- **WHEN** a member on a 390px-wide screen selects a post
- **THEN** the post detail fills the width, and Back to posts returns to the list with the same filters and scroll position

#### Scenario: Settings on a phone

- **WHEN** a member opens Course settings on a 390px-wide screen
- **THEN** the page does not scroll horizontally and all settings controls remain reachable

### Requirement: Course settings are organized into labeled sections

The Course settings content SHALL group course details, members, and destructive actions into separately headed sections. Course details SHALL show the course name field with a visible label and, for members whose role may view it, the join code with a copy control. Each member row SHALL show the member's name and role once, presenting an editable role control instead of a text label when the viewer may change that member's role. Archive and delete actions SHALL appear in a distinct section that identifies them as affecting the whole course. All form fields and buttons SHALL use the shared application styles. Existing role-based permissions, confirmations, and membership behavior SHALL be unchanged.

#### Scenario: An instructor reviews settings

- **WHEN** an instructor opens Course settings for an active course
- **THEN** separate headed sections show course details with the join code, the member list with one role presentation per member, and archive and delete actions

### Requirement: Home shows only real data

The `/home` route SHALL show the current local date, a greeting using the signed-in user's first name, and the member's courses as its primary content with Create course and Join a course actions. The home route SHALL not display hardcoded, sample, or placeholder posts, counts, or course names.

#### Scenario: A member signs in

- **WHEN** a member reaches `/home`
- **THEN** the page shows today's date and their actual courses, and shows no post previews that were not returned by the API

### Requirement: Programmatic heading focus is not visually outlined

When a route change moves focus to the page heading for assistive-technology announcement, the heading SHALL not display a focus indicator unless focus reached it through keyboard navigation. Keyboard focus indicators on interactive controls SHALL remain visible.

#### Scenario: A member opens a course

- **WHEN** a member navigates to a course and focus moves to its heading
- **THEN** the heading receives focus without a visible focus outline, while tabbing to any control shows that control's focus indicator

### Requirement: The search field shows its state and syntax

The course search field SHALL show a search icon, and while it contains text it SHALL show a Clear search control that empties the field, removes `q` immediately, and returns focus to the field. While the field has focus, the supported syntax (words, quoted phrases, `OR`, and excluded terms) SHALL be visible as well as described to assistive technology. Pressing `/` while focus is not in a text field, select, or editable region SHALL move focus to the search field without typing the character. While a search is applied and its first page has loaded with at least one result, the feed SHALL state the number of loaded results with the applied query, indicating when more results are available, in a polite live region; a search with no results is described by the no-match state instead. The Posts/Duplicate posts selector SHALL be a two-option toggle labeled Post view that exposes the selected option to assistive technology.

#### Scenario: A member clears a search with the Clear search control

- **WHEN** a member with an applied search activates Clear search
- **THEN** the field empties, `q` is removed from the URL, the unfiltered feed loads, and focus returns to the search field

#### Scenario: A member presses slash

- **WHEN** a member presses `/` while focus is on a post row
- **THEN** focus moves to the search field and no `/` is entered

#### Scenario: A search returns results

- **WHEN** a search for `integration` returns four posts and no further page
- **THEN** the feed states `4 results for "integration"`

### Requirement: A search can become a new question

While a search is applied in the Posts view of an active course, the feed SHALL offer to ask the applied query as a new question, after any results and in the no-match state. Activating it SHALL open the composer as a question whose title is the applied query, limited to the title's 200-character maximum, and SHALL move focus to the body field. The prefilled title SHALL trigger the existing related-question suggestions. The prefilled title alone SHALL not count as an unsaved draft for discard confirmation. When another composer draft is already open, the existing discard confirmation SHALL apply first, and declining it SHALL keep that draft. The offer SHALL not appear for archived or deleting courses or in Duplicate posts mode.

#### Scenario: No results match a search

- **WHEN** a search for `integration by parts u choice` matches nothing and the member activates the offer to ask it as a question
- **THEN** the composer opens with that text as the question title, focus is in the body field, and related-question suggestions load for the title

#### Scenario: A member leaves a prefilled composer untouched

- **WHEN** a member opens the prefilled composer from a search and closes it without editing
- **THEN** no discard confirmation is shown
