## MODIFIED Requirements

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

### Requirement: Tests exercise UI behavior and real lexical search

Rendered React interaction tests SHALL cover feed cards, creation and field limits, related-question debounce/query bounds/dismissal, live-search debounce/request syntax/URL replacement/clear behavior, pagination/retry, stale-response isolation, and detail states. PostgreSQL-backed HTTP tests SHALL verify that a query `A cutoff` matches a post containing `Cutoffs for the course`, along with a body-only match, quoted phrase match, and excluded-term nonmatch. Tests SHALL not assert a reverse match when the `course` term is absent or substitute a mocked browser search algorithm for database behavior.

#### Scenario: English full-text stemming and stop words apply

- **WHEN** a course member searches for `A cutoff` after a post titled `Cutoffs for the course` exists
- **THEN** the HTTP API includes that post in the search results

## REMOVED Requirements

### Requirement: Search uses the documented course full-text interface

**Reason**: The submit-only interaction is replaced by live search while retaining the same API and full-text syntax.

## ADDED Requirements

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
