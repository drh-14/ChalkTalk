# question-followups Specification

## Purpose
Lets course members discuss a question before or after answers exist, including nested replies and versioned moderation while preserving anonymous author privacy.

## Requirements

### Requirement: Members create question-level followups

`POST /api/v1/posts/{postId}/followups` SHALL create a direct followup on a visible question, and `POST /api/v1/followups/{parentId}/replies` SHALL create a reply under a followup of the same question. Current members of active courses SHALL provide JSON `bodyMarkdown` of 1–100,000 non-whitespace characters and optional boolean `anonymous`; no attachments SHALL be accepted. Creation SHALL return `201`, Location, ETag and version 1, with idempotent retry semantics. A note SHALL return `409 not_a_question`; hidden/cross-course/nonmember content `404`; inactive course `409`.

#### Scenario: Start discussion before an answer exists
- **WHEN** a member creates a direct followup on a question with zero answers
- **THEN** the followup is created and appears in that question's root list

#### Scenario: Reply to another question is rejected
- **WHEN** a reply target does not belong to the visible question context
- **THEN** the operation fails without creating a row

### Requirement: Members read a paginated followup tree

`GET /api/v1/posts/{postId}/followups` SHALL return a deterministic cursor page of direct roots and a total root count. `GET /api/v1/followups/{parentId}/replies` SHALL page direct children. `GET /api/v1/followups/{id}` SHALL return one visible followup. The response SHALL include `upvoteCount` and `viewerUpvoted`. Anonymous author identity SHALL be visible to staff and the author and represented as Anonymous to other students; deleted accounts SHALL not expose IDs.

#### Scenario: Empty discussion
- **WHEN** a member lists roots on a question without followups
- **THEN** the response has an empty page and total root count zero

### Requirement: Authors and staff manage followups conditionally

`PATCH /api/v1/followups/{id}` and `DELETE /api/v1/followups/{id}` SHALL require a current ETag, an active course, and the author or current staff role. Stale/missing ETags SHALL yield `412`/`428`. A deleted followup with descendants SHALL retain a bodyless tombstone so replies remain navigable; deleted leaf content SHALL be absent from ordinary reads. Edits SHALL advance the version and ETag.

#### Scenario: Delete parent with a reply
- **WHEN** an authorized member deletes a followup with children
- **THEN** its body is removed and a tombstone remains above its replies

#### Scenario: Unrelated student attempts edit
- **WHEN** a student other than the author edits a followup
- **THEN** the request returns `403 permission_denied` and the version stays unchanged

### Requirement: Followup bodies have durable Yjs documents

Every existing and newly created followup SHALL have a Yjs document containing the current body as `Y.Text('content')`. Initial backfill SHALL preserve body text and revision. Conditional REST edits SHALL update the same durable document and notify open collaboration nodes; stale `If-Match` SHALL still return `412`. Deletion or loss of visibility SHALL close editing and prevent new document loads. A temporarily empty live body SHALL remain readable with a placeholder and SHALL not be treated as a deleted tombstone.

#### Scenario: Existing followup migrates
- **WHEN** an existing followup is loaded for live editing after migration
- **THEN** its Yjs text equals its pre-migration Markdown body

#### Scenario: REST/live race
- **WHEN** REST and live edits race on a followup body
- **THEN** their writes serialize on the durable document and a stale REST precondition is rejected

#### Scenario: Deleted parent
- **WHEN** a followup becomes a bodyless tombstone
- **THEN** no editor can read or update its former body
