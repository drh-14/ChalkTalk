## ADDED Requirements

### Requirement: Members can save posts in one private list

A course member SHALL be able to save or unsave a readable active post. Saving is idempotent and scoped to the member; it SHALL NOT change the post's version, activity time, or other members' views. The post projection SHALL expose the viewer's saved state. A member SHALL NOT save a deleted, merged, unreadable, or out-of-course post. Saved entries SHALL cease to be visible whenever the member loses access to the course or post; deletion SHALL remove the entry. Only the owner SHALL see their saved state or list.

#### Scenario: Save and unsave a readable post

- **WHEN** a member saves a readable post twice and then unsaves it twice
- **THEN** both sets of requests succeed idempotently and only that member's saved projection changes

#### Scenario: Hidden post cannot be saved

- **WHEN** a member tries to save a private post that they cannot read
- **THEN** the API returns the same `404 not_found` response as for an absent post

### Requirement: Course list can filter by viewer state

The course post list SHALL support `unread=true`, `following=true`, and `saved=true` filters, individually or together with existing filters, search, sort, and cursor pagination. Each predicate SHALL use the same viewer-specific state as the post projection. Filtering SHALL happen before ordering and pagination, preserving pinned-first and existing search ranking. Unknown or invalid values SHALL return `400 invalid_request`; cursors SHALL be bound to normalized filters and viewer.

#### Scenario: Combined viewer filters

- **WHEN** a member lists posts with `unread=true&following=true&saved=true`
- **THEN** every returned post is unread, followed, and saved by that member, in the requested order

#### Scenario: Invalid viewer filter

- **WHEN** a member requests `saved=false` or `unread=other`
- **THEN** the API returns `400 invalid_request`

### Requirement: Feed snapshot and matching new-post count

The course list SHALL issue an opaque server-origin snapshot token in a response header, representing committed post creations at the start of that list request. A member MAY query the count of newly created posts visible since that snapshot using the same course, viewer, and active filters. The count SHALL include all matching newly created posts, not only the first page, and SHALL exclude edits, activity on old posts, deleted and confirmed-duplicate posts, and private posts the viewer cannot read. The notice is best-effort: a rare post whose creation transaction began before the snapshot and committed afterward MAY not be counted; manual feed refresh SHALL still show it. Counting SHALL NOT mark posts read, mutate pagination, or disclose hidden posts. Malformed or cross-course/viewer tokens SHALL return `400 invalid_request`.

#### Scenario: New matching post arrives

- **WHEN** a member has a feed snapshot with an active `following=true` filter and a newly created matching post becomes visible
- **THEN** the new-post count increases without changing the old feed response or cursor

#### Scenario: Old post gains activity

- **WHEN** an existing post receives a new answer after the snapshot
- **THEN** it does not increase the new-post count

#### Scenario: Private creation

- **WHEN** a private post is created after a snapshot and the viewer cannot read it
- **THEN** it never contributes to that viewer's count
