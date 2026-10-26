### Requirement: Feed snapshot and matching new-post count

The course list SHALL issue an opaque-to-clients, unsigned server-origin snapshot token in a response header, representing committed post creations at the start of that list request. The token SHALL NOT be treated as authentication, authorization, or cryptographic proof of issuance; a caller MAY choose a different timestamp, but the count SHALL still apply current session, membership, and post visibility. A member MAY query the count of newly created posts visible since that snapshot using the same course, viewer, and active filters. The count SHALL include all matching newly created posts, not only the first page, and SHALL exclude edits, activity on old posts, deleted and confirmed-duplicate posts, and private posts the viewer cannot read. The notice is best-effort: a rare post whose creation transaction began before the snapshot and committed afterward MAY not be counted; manual feed refresh SHALL still show it. Counting SHALL NOT mark posts read, mutate pagination, or disclose hidden posts. Malformed or cross-course/viewer tokens SHALL return `400 invalid_request`.

#### Scenario: New matching post arrives

- **WHEN** a member has a feed snapshot with an active `type=note` filter and a newly created matching note becomes visible
- **THEN** the new-post count increases without changing the old feed response or cursor

#### Scenario: Old post gains activity

- **WHEN** an existing post receives a new answer after the snapshot
- **THEN** it does not increase the new-post count

#### Scenario: Private creation

- **WHEN** a private post is created after a snapshot and the viewer cannot read it
- **THEN** it never contributes to that viewer's count
