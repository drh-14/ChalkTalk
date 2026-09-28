## ADDED Requirements

### Requirement: Course members can browse a discussion-first post feed

The protected `/courses/{courseId}` route SHALL show question and note post cards in a left-hand feed with title and plain-text body excerpt, with post detail beside the feed on wide screens. The feed SHALL preserve API order and show loading, empty, error, and retry states. Existing member and course-management controls SHALL remain available from a clearly labeled `/courses/{courseId}/settings` route. On narrow screens, feed and selected detail SHALL remain navigable without relying on hover.

#### Scenario: A member opens a course with posts

- **WHEN** a signed-in course member opens the course discussion route
- **THEN** the browser lists server-returned post cards in server order and provides an accessible Create post control above them

#### Scenario: A member opens Course settings

- **WHEN** a member follows the Course settings navigation
- **THEN** the existing roster and role-appropriate course actions remain reachable

### Requirement: Post detail is shareable and viewer-safe

The browser SHALL support `/courses/{courseId}/posts/{postId}` as a direct link, fetch the post independently of the current feed page, and display the API's viewer-projected author. It SHALL render Markdown without raw HTML execution or unsafe links. A tombstone SHALL show a deleted state without old content; an absent, hidden, or wrong-course result SHALL show an unavailable state without stale identity or body content. Browser Back/Forward SHALL restore selection and the submitted query.

#### Scenario: A member opens a post directly

- **WHEN** a member loads a post URL whose post is not in the first feed page
- **THEN** the browser fetches and displays that post without requiring a card to be loaded first

#### Scenario: A selected post is deleted or hidden

- **WHEN** detail retrieval returns a tombstone or `404`
- **THEN** the browser displays the appropriate deleted or unavailable state and does not retain the previous post's content or author

### Requirement: Search uses the documented course full-text interface

Search SHALL run on Enter or Search-button submission, not on each keystroke. A nonempty submitted query SHALL be trimmed at its edges, stored as `q` in the URL, and sent to the course posts API with `sort=relevance`; an empty submission SHALL clear the query and return to the unfiltered feed. The browser SHALL pass PostgreSQL web-search syntax through without its own parser, preserve API result order, and reset pagination when the submitted query changes. Search controls SHALL describe words, quoted phrases, `OR`, and excluded terms.

#### Scenario: A member submits a search

- **WHEN** a member enters `A cutoff` and submits it
- **THEN** the browser requests the encoded `q=A cutoff` with `sort=relevance`, updates the URL, and displays the posts returned by the API

#### Scenario: A member edits a search draft

- **WHEN** the member changes the search field but has not submitted it
- **THEN** the current results and URL remain unchanged

### Requirement: Pagination is isolated to the current course and query

The feed SHALL append subsequent cursor pages without duplicate cards and SHALL not mix pages or stale responses from another course or submitted query. A later-page failure SHALL retain previously visible cards and allow a retry using the same cursor. Loading and retry controls SHALL prevent duplicate concurrent page requests.

#### Scenario: A later page fails and is retried

- **WHEN** loading more posts fails after an initial page succeeded
- **THEN** the first page remains visible and a retry can load the next page without duplicate cards

#### Scenario: An old search response arrives late

- **WHEN** a previous query resolves after a newer submitted query
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

The panel SHALL have loading, empty, and error states and a close control; superseded responses SHALL not replace newer suggestions. Pointer exit SHALL dismiss the panel unless focus remains within it, while keyboard and touch users SHALL be able to dismiss it with Escape, focus departure, or the close control. A suggestion SHALL link to its shareable post in a new tab with safe link attributes, preserving the unsent draft. Suggestions SHALL never block creation.

#### Scenario: Title and body edits update suggestions

- **WHEN** a member edits the full title and then the body of a question draft
- **THEN** each edit updates the debounced course-scoped question search without exceeding 500 characters of `q`, each request sets `limit=10`, and the panel shows no more than 10 results

#### Scenario: A member inspects a related question

- **WHEN** the member opens a related-question result
- **THEN** the post opens in a new tab and the current draft remains available

### Requirement: Tests exercise UI behavior and real lexical search

Rendered React interaction tests SHALL cover feed cards, creation and field limits, related-question debounce/query bounds/dismissal, submitted search request syntax, URL state, pagination/retry, stale-response isolation, and detail states. PostgreSQL-backed HTTP tests SHALL verify that a query `A cutoff` matches a post containing `Cutoffs for the course`, along with a body-only match, quoted phrase match, and excluded-term nonmatch. Tests SHALL not assert a reverse match when the `course` term is absent or substitute a mocked browser search algorithm for database behavior.

#### Scenario: English full-text stemming and stop words apply

- **WHEN** a course member searches for `A cutoff` after a post titled `Cutoffs for the course` exists
- **THEN** the HTTP API includes that post in the search results
