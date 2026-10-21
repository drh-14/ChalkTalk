# Spec Delta

## REMOVED Requirements

### Requirement: Unsupported variants remain outside this phase

**Reason**: Polls are now supported; the remaining rules move to "Posts stay JSON-only and tombstones stay final".

**Migration**: None for clients. Poll creation and `type=poll` filtering now succeed as specified below, and vote routes are registered.

## ADDED Requirements

### Requirement: Posts stay JSON-only and tombstones stay final

PATCH or DELETE of an already-deleted post SHALL return `404 not_found`. Post creation and text updates SHALL remain JSON-only, multipart create/update requests SHALL return `422 validation_failed`, and attachments SHALL use separate parent-scoped multipart endpoints.

#### Scenario: A member sends a multipart post

- **WHEN** a course member submits a post as `multipart/form-data`
- **THEN** the API returns `422 validation_failed` without writing a post

### Requirement: Staff can create polls

A TA or instructor SHALL be able to create a post with `type: poll`, a title (1–200 characters), a Markdown body (1–100,000 characters), optional tags, optional anonymity, and `options`: 2 to 10 labels of 1–200 characters after trimming, distinct ignoring case, kept in the given order. A student's poll creation SHALL return `403 permission_denied` without writing a post. A poll's options SHALL not change after creation; a PATCH SHALL accept only the fields allowed for other posts. Polls SHALL not accept answers or followups. Every poll projection, in lists and in detail, SHALL include `options` (each `id`, `label`, `voteCount`, and `selected` for the viewer) and `totalVotes`. The list `type` filter SHALL accept `poll`.

#### Scenario: A TA runs a quick poll

- **WHEN** a TA creates a poll "Which review session time works?" with three options
- **THEN** the post appears in the feed with three options, no votes, and the TA as author

#### Scenario: A student tries to create a poll

- **WHEN** a student submits a post with `type: poll`
- **THEN** the API returns `403 permission_denied` and no post is created

### Requirement: Members vote on polls

`PUT /api/v1/posts/{postId}/vote` with `{ "optionId": "…" }` SHALL record the caller's single vote on an active poll, replacing any earlier vote, and return `200` with the poll's `postId`, updated `options`, and `totalVotes`. `DELETE /api/v1/posts/{postId}/vote` SHALL remove the caller's vote and return `204`, even when they had none. Voting SHALL require current course membership and CSRF protection like other writes, return `404 not_found` for a hidden, deleted, or other-course post, `422 not_a_poll` for a non-poll post, `422 poll_option_invalid` for an option of another poll, and `409 poll_closed` when the course is archived. Vote counts SHALL be visible to every member; who voted for what SHALL not be exposed. Votes SHALL be removed with their poll's course.

#### Scenario: A student changes their vote

- **WHEN** a student votes for one option and then for another
- **THEN** the poll shows one vote, on the second option, selected for that student

#### Scenario: A poll in an archived course

- **WHEN** a member votes in an archived course
- **THEN** the API returns `409 poll_closed` and the votes are unchanged

### Requirement: Staff can post announcements

A TA or instructor SHALL be able to create a note with `announcement: true`. An announcement SHALL be pinned on creation, SHALL not be anonymous (`422 validation_failed`), and SHALL report `announcement: true` in every projection; other posts report `false`. A student's announcement SHALL return `403 permission_denied` without writing a post, and `announcement` SHALL be rejected on questions and polls with `422 validation_failed`. Staff may later unpin an announcement; it stays an announcement. The list SHALL accept `announcement=true` to return only announcements. The feed and post detail SHALL show an **Announcement** badge.

#### Scenario: An instructor moves office hours

- **WHEN** an instructor posts the note "Office hours moved to Thursday" as an announcement
- **THEN** it appears pinned at the top of the feed with an **Announcement** badge

### Requirement: Announcements are emailed to the course

Creating an announcement SHALL queue, in the same transaction, one email job for each other current course member whose account is not deleted. The job worker SHALL send each email only if the announcement is still active and an announcement, the course is still active, and the recipient is still a member; otherwise it SHALL send nothing. The subject SHALL be `[<course name>] <title>` and the text SHALL name the author and course, include the title and the Markdown body (truncated to 2,000 characters with an ellipsis), and link to the post.

#### Scenario: A student is emailed an announcement

- **WHEN** an instructor posts an announcement in a course with two students
- **THEN** each student receives one email with the announcement and a link to it, and the instructor receives none

#### Scenario: An announcement is deleted before sending

- **WHEN** an announcement is deleted before the worker processes its emails
- **THEN** no email is sent

### Requirement: Tests cover polls and announcements

API tests SHALL cover poll creation (validation, staff-only, projection, list filter), voting (cast, change, retract, each error, archived course), announcement creation (staff-only, pinned, not anonymous, type rules, filter), and the queued email jobs. Worker tests SHALL cover the announcement email's content and every skip condition. Component tests SHALL cover the composer's poll options editor and announcement choice, voting and counts, and the badge. A browser test SHALL show a TA creating a poll, a student voting and changing their vote, and an instructor's announcement appearing pinned with its badge.

#### Scenario: A student's poll is accepted

- **WHEN** a change lets a student create a poll
- **THEN** an automated test fails
