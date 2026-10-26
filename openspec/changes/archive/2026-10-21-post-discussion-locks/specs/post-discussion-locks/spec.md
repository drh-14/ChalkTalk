## Purpose

Lets course staff pause new participation on one post while preserving its readable history, ordinary edits, and existing moderation markers.

## ADDED Requirements

### Requirement: Staff conditionally lock or unlock a post

The system SHALL let current course staff change an active, visible question's or poll's discussion lock through a conditional request. It SHALL reject note and announcement requests with `422 validation_failed` without changing version or activity, and reject non-staff, absent or stale preconditions, and inaccessible or deleted posts. A successful state change SHALL increment the post version without changing its last-activity feed position; an unchanged request SHALL be idempotent.

#### Scenario: Staff lock an active post

- **WHEN** a staff member submits `PUT /api/v1/posts/{postId}/discussion-lock` with `{ "locked": true }` and the current post ETag
- **THEN** the response returns the locked post and its new ETag, and the post retains its prior last-activity timestamp

#### Scenario: Authorization and concurrency

- **WHEN** a student or outsider requests a lock change, or staff omits or supplies a stale ETag
- **THEN** the system rejects the request without changing lock state

#### Scenario: Note and announcement are not lockable

- **WHEN** staff submits a lock or unlock request for a note or announcement
- **THEN** the system responds with `422 validation_failed` and leaves its version and activity unchanged

### Requirement: Lock state is visible to authorized readers

The system SHALL include a boolean `discussionLocked` in readable post list and detail projections, always `false` for notes and announcements, and show a clear locked indicator and staff lock control only for questions and polls in the UI.

#### Scenario: Read locked content

- **WHEN** a member opens or finds a locked question or poll
- **THEN** they can read its existing content and see that new discussion and voting are closed

### Requirement: Locks block new discussion and all vote endpoints

For a locked post, the system SHALL reject creation of answers, root followups, and replies and every poll ballot, ballot retraction, answer-upvote, and followup-upvote request, including vote retractions. It SHALL enforce the lock atomically with each mutation so no participation commits after a completed lock. A failed mutation SHALL not alter content or votes.

#### Scenario: New discussion on locked question

- **WHEN** a member submits a new answer, followup, or reply to a locked question
- **THEN** the system responds with a discussion-locked conflict and creates no content

#### Scenario: Vote changes on locked post

- **WHEN** a member casts, changes, repeats, or retracts a poll ballot or changes or retracts an answer or followup upvote on a locked post
- **THEN** the system responds with a discussion-locked conflict and preserves the previous vote state

### Requirement: Locks preserve existing content management

A post lock SHALL NOT prevent authorized reading, editing or deletion of existing posts, answers or followups, or staff resolution-marker changes. Unlocking SHALL restore normal participation subject to other course and content rules.

#### Scenario: Existing content remains manageable

- **WHEN** a locked question has existing answers and followups
- **THEN** authorized editors can edit or delete them and staff can resolve or reopen an existing followup while new discussion and votes remain blocked
