# post-drafts Specification

## Purpose

Post drafts keep incomplete new-post text and metadata private to their author across sessions and devices, without creating a visible discussion post or storing attachments.

## Requirements

### Requirement: Private durable draft lifecycle

The API SHALL expose exactly one private new-post draft resource per current user and course. Reading it SHALL return its content, if any, and current version with a private, no-store cache policy and `ETag: "vN"`; an unused resource SHALL have no content and version zero. A member SHALL conditionally replace or discard their own draft. No draft content SHALL be exposed to another member, including staff, or appear in the post feed. Draft content SHALL not expire. A content-free revision marker SHALL remain after discard or successful publication so a stale device cannot recreate old content. Leaving the course, deleting the account, or deleting the course SHALL remove the draft and marker.

#### Scenario: One course draft across devices

- **WHEN** a member edits a new post in one browser and opens New post in another browser
- **THEN** the latest saved text and metadata are automatically restored without selecting from a list

#### Scenario: Several drafts in one course

- **WHEN** the same owner saves different text for two unfinished posts in one course
- **THEN** only the latest single course draft is retained, rather than two independently selectable drafts

#### Scenario: Owner isolation

- **WHEN** another member, including staff, requests the owner's course draft
- **THEN** that member receives only their own draft resource and no owner content

#### Scenario: Course/account lifecycle

- **WHEN** a member leaves a course, deletes their account, or the course is deleted
- **THEN** the draft and its revision marker are removed with that membership or course

### Requirement: Partial text and metadata only

A draft SHALL store the current new-post type, title, Markdown body, anonymity, tags, privacy, announcement choice, and poll-option labels as applicable. Title, body, tags, and poll options MAY be incomplete or empty while drafted, subject to maximum post input lengths and types. The API SHALL reject unknown fields, attachments, file bytes, or unsupported types. Saving a draft SHALL NOT create a post, notification, digest activity, or poll. Publishing SHALL still apply complete post validation and permission rules.

#### Scenario: Incomplete poll draft

- **WHEN** staff saves a poll with one filled option and an empty body
- **THEN** the partial poll persists but cannot be published until normal validation passes

#### Scenario: Queued attachment

- **WHEN** a browser queues a file beside a draft
- **THEN** the draft API does not receive that file and reload does not claim to restore it

### Requirement: Conditional draft mutation and recovery

Saving or discarding a draft SHALL require `If-Match` with its current ETag. A missing precondition SHALL return `428 precondition_required`; a stale version SHALL return `412 version_conflict` without overwriting the current draft. A conflict in the composer SHALL retain local content and offer Reload saved draft or an explicitly confirmed Overwrite saved draft action; neither version SHALL be silently lost. Overwrite SHALL first obtain the current server version and retry conditionally, so a further concurrent change is again reported as a conflict.

#### Scenario: Concurrent devices edit one course draft

- **WHEN** device B saves after device A read version 1, then A saves with version 1
- **THEN** A receives `412`, B's version remains intact, and A may reload or confirm a conditional overwrite

#### Scenario: Stale device after successful publish

- **WHEN** device B publishes while device A still holds an earlier draft version and A attempts to autosave
- **THEN** the stale save fails with `412`, no draft content reappears, and A's local text remains available for explicit recovery

#### Scenario: Stale discard

- **WHEN** a member discards using an old ETag
- **THEN** the server returns `412` and keeps the current content

### Requirement: Archived-course draft access

A current member of an archived course SHALL be able to read and discard their own existing draft but SHALL NOT save or publish it. Saving or publishing SHALL return `409 course_archived` without changing the draft or creating a post. A deleted or inaccessible course SHALL reveal no draft content.

#### Scenario: Archived course

- **WHEN** a course is archived after a draft was saved
- **THEN** its owner can read or discard the draft, but save and publish attempts return `409 course_archived`

### Requirement: Debounced composer autosave and draft management

Opening New post SHALL automatically load and restore the owner's course draft before autosave can run. A saved draft SHALL take precedence over any suggested title prefill, with a visible restored-draft notice. The composer SHALL debounce text/metadata autosaves and display saving, saved, error, and conflict states. It SHALL have no draft list, named-draft workflow, or save-as-new action. Discard SHALL require confirmation, clear both local and server draft content, and preserve a content-free revision marker. Unsent attachments SHALL remain device-local, with an explicit warning that they are not durable.

Closing or navigating away with an unsaved or in-flight revision SHALL be blocked until the latest revision is saved. A failed save SHALL retain local content and offer Retry or explicit Discard local changes. Device-local queued attachments SHALL still require explicit discard confirmation when leaving.

#### Scenario: Reopen after reload

- **WHEN** a member edits a new post, waits for autosave, reloads, and opens New post
- **THEN** the latest text and metadata are restored automatically and no attachment is falsely restored

#### Scenario: Save failure

- **WHEN** autosave fails
- **THEN** local text remains available with a retry action and unsaved indication

#### Scenario: Leave while save is pending

- **WHEN** a member tries to leave before the latest revision is saved
- **THEN** the attempted navigation is held until a later leave attempt after successful save

#### Scenario: Leave after save failure

- **WHEN** the save fails during an attempted departure
- **THEN** the composer keeps local content with explicit Retry and Discard local changes actions
