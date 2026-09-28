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

On screens wider than 850px, the left-hand post cards and their Load more control SHALL occupy a viewport-bounded, visibly scrollable region. The Posts/Duplicate posts selector, search field, and Create post button SHALL remain above that region. The region SHALL have an accessible name and be keyboard-focusable. The same structure SHALL apply to normal posts and staff duplicate review cards. On screens at or below 850px, the cards SHALL use natural page scrolling rather than a nested scroll area. The right-hand detail pane SHALL not be constrained by this feed behavior.

#### Scenario: A member browses a long post list

- **WHEN** a member scrolls the desktop post list
- **THEN** post cards and Load more move within the left-hand pane while its controls remain available above the list

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

Search SHALL update after approximately 300 ms without input changes, with no Search button or Enter submission requirement. The browser SHALL trim a nonempty query at its edges, limit it to the API's 500-character `q` maximum, store the applied query as `q` in the URL by replacing the current history entry, and send it to the course posts API with `sort=relevance`. Clearing the input SHALL immediately remove `q` and restore the unfiltered feed. The browser SHALL pass PostgreSQL web-search syntax through without its own parser, preserve API result order, and reset pagination when the applied query changes. Live search SHALL not close a selected post or composer, discard an unsent draft, or trigger draft-discard confirmation. Search controls SHALL describe words, quoted phrases, `OR`, and excluded terms to assistive technology.

#### Scenario: A member types a search

- **WHEN** a member enters `A cutoff` and pauses for approximately 300 ms
- **THEN** the browser requests encoded `q=A cutoff` with `sort=relevance`, replaces the URL query, and displays the posts returned by the API without a Search-button click

#### Scenario: A member clears the search

- **WHEN** a member clears a nonempty live search field
- **THEN** the browser immediately removes `q`, resets pagination, and loads the unfiltered feed

#### Scenario: A member searches with a draft open

- **WHEN** a member changes the live search while an unsent post composer or selected post is open
- **THEN** only the left feed and its URL query change; the composer draft or selected post remains available without a discard prompt

### Requirement: Course discussion and settings share a stable frame

The protected Discussion and Course settings routes for the same course SHALL render the same course name, Back to courses control, and Discussion/Settings navigation in a persistent course header. Switching between them SHALL use same-document navigation, not reload the application or re-run session restoration. The active navigation item SHALL be identifiable visually and to assistive technology. Settings content MAY remain narrower than the discussion content.

#### Scenario: A member opens Course settings from Discussion

- **WHEN** a signed-in member activates Course settings
- **THEN** the course header remains visible, the URL changes to `/courses/{courseId}/settings` without a document reload, and the settings content replaces the discussion content

#### Scenario: A member returns to Discussion

- **WHEN** a member activates Discussion from Course settings or uses browser Back
- **THEN** the shared header remains, the discussion content returns, and the appropriate navigation item is active

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
