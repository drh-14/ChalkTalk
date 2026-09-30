## MODIFIED Requirements

### Requirement: Search and pagination cannot reveal hidden identities

Course lists SHALL implement the documented full-text query, type, repeated-tag OR, author, author-role, date, answered, pinned, duplicate-status, sorting, limit, and cursor rules for supported text posts. Deleted posts SHALL be absent from every course list, whether unfiltered or filtered, and SHALL not influence ranking, pagination, `hasMore`, or counts. An `authorId` filter SHALL remove items whose author identity is hidden from the viewer before ranking, pagination, `hasMore`, or counts. Cursors SHALL be stable and bound to course, viewer, sort, and normalized filters.

When the author account is deleted, student `authorId` filters SHALL exclude that author's posts even when the posts were nonanonymous. Staff MAY still match them, with a deleted-author projection. Invalid cursor sort values SHALL return `400 invalid_request` rather than reaching a database cast error.

`sort=oldest` SHALL order posts by creation time ascending with the post ID as a tiebreaker. Pages SHALL continue without repeats or gaps, and it SHALL be valid with or without `q`.

`pinned=true` and `pinned=false` SHALL return only posts with that pinned state and SHALL combine with the other filters.

`authorRole=instructor` SHALL return only posts whose author currently holds an instructor membership in the course, and `authorRole=ta` only posts whose author currently holds a TA membership. Posts by deleted accounts, or by members whose role has since changed, therefore match only their current role. For a student, either value SHALL also remove anonymous posts other than the student's own before ranking, pagination, `hasMore`, or counts, so it cannot reveal an anonymous author's role. TAs and instructors SHALL match anonymous posts by that role. Any other `authorRole` value or a non-boolean `pinned` value SHALL return `400 invalid_request`.

#### Scenario: Only hidden anonymous posts match an author filter

- **WHEN** a student filters by another author's ID and all matching posts are anonymous
- **THEN** the API returns `200` with an empty collection and `hasMore: false`

#### Scenario: A cursor is replayed against another course or filter

- **WHEN** a caller supplies a cursor from a different result set
- **THEN** the API returns `400 invalid_request`

#### Scenario: A deleted post is listed

- **WHEN** a member lists posts after a post is deleted, with or without filters that would have matched it
- **THEN** the deleted post is absent and does not affect the page or `hasMore`, while direct GET by its ID still returns its tombstone

#### Scenario: A member pages through posts oldest first

- **WHEN** a member lists with `sort=oldest` and follows each `nextCursor`
- **THEN** every post appears exactly once, in ascending creation order

#### Scenario: A member lists pinned questions

- **WHEN** a member lists with `type=question&pinned=true`
- **THEN** only pinned questions are returned

#### Scenario: A member lists instructor posts

- **WHEN** a member lists with `authorRole=instructor` and the course has a nonanonymous instructor post, a nonanonymous TA post, and a student post
- **THEN** only the instructor post is returned

#### Scenario: A member lists TA posts

- **WHEN** a member lists with `authorRole=ta` in the same course
- **THEN** only the TA post is returned

#### Scenario: A student lists by role with an anonymous staff post

- **WHEN** the course also has an anonymous instructor post, and a student lists with `authorRole=instructor`
- **THEN** the anonymous instructor post is omitted for the student but returned for a TA or instructor viewer

#### Scenario: A caller sends an unsupported author role

- **WHEN** a member lists with `authorRole=staff`, `authorRole=student`, or `pinned=yes`
- **THEN** the API returns `400 invalid_request`
