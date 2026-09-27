# text-posts Specification

## Purpose

Define the current JSON-only question and note API, including course isolation, viewer-aware author identity, text search, conditional edits, and retained direct-read tombstones.

## Requirements

### Requirement: Members can create and retrieve text posts

The API SHALL support JSON `question` and `note` creation, course listing/search, and global-ID retrieval using the documented active post shape, response envelopes, `Location`, and ETag headers. Active posts SHALL expose `attachments: []`; questions SHALL expose `answered: false` until answers are implemented. Creation SHALL honor a matching `Idempotency-Key` for 24 hours and reject conflicting reuse.

#### Scenario: A member creates a question

- **WHEN** an authenticated course member submits a valid JSON question with a title, Markdown body, and tags
- **THEN** the API returns `201`, `Location`, an ETag, a new post in that course, normalized tags, an empty attachment list, and `answered: false`

#### Scenario: A matching creation request is retried

- **WHEN** the same caller repeats the same create request with the same unexpired idempotency key
- **THEN** the API returns the original result without creating a second post

### Requirement: Every post operation is isolated by current course membership

Every create, list, get, update, and delete operation SHALL require current membership in the post's course. Global post-ID routes SHALL return the same `404 not_found` for absent posts and posts hidden from the caller. Membership in another course or shared organization affiliation SHALL not grant access.

#### Scenario: A Course A member knows a Course B post ID

- **WHEN** that member requests or mutates the Course B post through a global post-ID route
- **THEN** the API returns `404 not_found` without revealing content or field-level permission details

#### Scenario: A nonmember lists a course's posts

- **WHEN** a signed-in nonmember requests a course post list
- **THEN** the API returns `404 not_found`

### Requirement: Author identity is projected for each viewer

Post responses SHALL follow `documentation/api/identity-visibility.md`. Anonymous content SHALL reveal the real author only to that author and course staff. Deleted authors SHALL have a null ID, `Deleted user` display name, `deleted: true`, and the original anonymity flag. A projection made for one viewer SHALL not be reused for another.

#### Scenario: Another student reads an anonymous question

- **WHEN** a student other than the author retrieves an anonymous question
- **THEN** its author has `userId: null`, `displayName: "Anonymous"`, `anonymous: true`, and `deleted: false`

#### Scenario: Staff reads the same question

- **WHEN** a TA or instructor retrieves that question
- **THEN** its author has the real user ID and display name with `anonymous: true`

### Requirement: Search and pagination cannot reveal hidden identities

Course lists SHALL implement the documented full-text query, type, repeated-tag OR, author, date, answered, duplicate-status, sorting, limit, and cursor rules for supported text posts. Deleted posts SHALL be absent from every course list, whether unfiltered or filtered, and SHALL not influence ranking, pagination, `hasMore`, or counts. An `authorId` filter SHALL remove items whose author identity is hidden from the viewer before ranking, pagination, `hasMore`, or counts. Cursors SHALL be stable and bound to course, viewer, sort, and normalized filters.

When the author account is deleted, student `authorId` filters SHALL exclude that author's posts even when the posts were nonanonymous. Staff MAY still match them, with a deleted-author projection. Invalid cursor sort values SHALL return `400 invalid_request` rather than reaching a database cast error.

#### Scenario: Only hidden anonymous posts match an author filter

- **WHEN** a student filters by another author's ID and all matching posts are anonymous
- **THEN** the API returns `200` with an empty collection and `hasMore: false`

#### Scenario: A cursor is replayed against another course or filter

- **WHEN** a caller supplies a cursor from a different result set
- **THEN** the API returns `400 invalid_request`

#### Scenario: A deleted post is listed

- **WHEN** a member lists posts after a post is deleted, with or without filters that would have matched it
- **THEN** the deleted post is absent and does not affect the page or `hasMore`, while direct GET by its ID still returns its tombstone

### Requirement: Text posts support conditional edits, duplicate review, and tombstones

The author or staff SHALL be able to edit ordinary text fields; any course member MAY suggest an active same-course duplicate; only staff SHALL confirm or clear duplicate review and change pinning. A duplicate target SHALL exist, be active, and belong to the same course. Update and delete SHALL require `If-Match`, reject stale revisions, and reject writes to archived or deleting courses. Delete SHALL return `204` and retain a minimal tombstone visible to current course members with only `id`, `courseId`, `type`, `deleted: true`, `createdAt`, `updatedAt`, and `version`.

#### Scenario: A student suggests a duplicate without content-edit permission

- **WHEN** a nonauthor course member conditionally sets a valid same-course duplicate suggestion
- **THEN** the suggestion succeeds, but an attempted title or body edit by that member is forbidden

#### Scenario: A post is deleted

- **WHEN** its author or course staff deletes an active post with a current ETag
- **THEN** delete returns `204`, later member retrieval returns the seven-field tombstone, and further mutation is rejected

### Requirement: Unsupported variants remain outside this phase

For this phase, PATCH or DELETE of an already-deleted post SHALL return `404 not_found`. The API Markdown and OpenAPI SHALL visibly annotate poll, vote, multipart, and attachment behavior as future-only while preserving their target definitions.

This phase SHALL reject poll creation and multipart create/update requests with `422 validation_failed`, reject a poll list filter with `400 invalid_request`, and SHALL NOT register vote routes. The target reference may retain these future definitions, but the implementation status SHALL not claim they are live.

#### Scenario: A member attempts to create a poll

- **WHEN** a course member submits a JSON post with `type: poll`
- **THEN** the API returns `422 validation_failed` without writing a post

### Requirement: Course deletion cleans post data

The durable course-deletion worker SHALL remove post-tag links, posts, and tags before removing the course, without breaking retry after a partial cleanup failure.

#### Scenario: A course with posts is deleted

- **WHEN** course deletion is accepted and its worker completes
- **THEN** the course, its posts, and its tags are removed and the course becomes not found

### Requirement: Tests enforce the text-post contract

HTTP tests backed by isolated PostgreSQL schemas SHALL be derived from the applicable API and database references. They SHALL cover successful behavior and response headers, authentication/CSRF, selected validation and revision errors, persistence constraints, identity visibility, and cross-course isolation. Each new behavior slice SHALL first fail for the expected reason before implementation makes it pass.

#### Scenario: A hidden post becomes observable after a regression

- **WHEN** a code change exposes a cross-course post or hidden anonymous author
- **THEN** an automated contract test fails
