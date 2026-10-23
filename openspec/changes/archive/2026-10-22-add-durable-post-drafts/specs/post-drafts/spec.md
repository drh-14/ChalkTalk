## Purpose

Post drafts keep incomplete new-post text and metadata private to their author across sessions and devices, without creating a visible discussion post or storing attachments.

## ADDED Requirements

### Requirement: Private durable draft lifecycle

The API SHALL let a current course member create multiple new-post drafts in the course, list their own drafts newest-first, read one draft, conditionally replace its partial content, and conditionally discard it. Each draft SHALL have a server-generated ID, course ID, current owner, created and updated timestamps, integer version, and `ETag: "vN"`. List/read responses SHALL use private no-store caching. Drafts SHALL have no expiration. The API SHALL never list or reveal a draft to another member, including staff. A nonmember or wrong owner SHALL receive `404 not_found` for a draft resource.

#### Scenario: Several drafts in one course

- **WHEN** a member saves two unfinished new posts in one course and later lists drafts from another session
- **THEN** both drafts are returned to that owner in descending update order, with their partial content intact

#### Scenario: Owner isolation

- **WHEN** another student or staff member requests one of the owner's drafts, including by ID
- **THEN** the API returns `404 not_found` without draft content

#### Scenario: Course/account lifecycle

- **WHEN** a member leaves the course, deletes their account, or the course is deleted
- **THEN** dependent drafts are removed with their membership or course, while drafts in unrelated courses remain

### Requirement: Partial text and metadata only

A draft SHALL store the current new-post type, title, Markdown body, anonymity, tags, privacy, announcement choice, and poll-option labels as applicable. Title, body, tags, and poll options MAY be incomplete or empty while drafted, subject to their maximum post input lengths and types. The API SHALL reject unknown fields, attachments, file bytes, or unsupported types. Saving a draft SHALL NOT create a post, notification, digest activity, or poll. Publishing SHALL still apply the complete post validation and permission rules.

#### Scenario: Incomplete poll draft

- **WHEN** staff saves a poll draft with only one filled option and an empty body
- **THEN** the draft is retained but cannot be published until it satisfies poll and post creation rules

#### Scenario: Queued attachment

- **WHEN** a browser has an attachment queued beside a draft
- **THEN** the attachment is not sent to or stored by the draft API, and a reload does not claim to restore it

### Requirement: Conditional draft mutation and recovery

Replacing or discarding a draft SHALL require `If-Match` with its current ETag. Missing preconditions SHALL return `428 precondition_required`; a stale version SHALL return `412 version_conflict` without overwriting or removing the server revision. On a save conflict the composer SHALL retain local content and offer explicit actions to reload the server revision or create a separate new draft from the local content; it SHALL NOT silently merge or overwrite either revision.

#### Scenario: Concurrent devices edit one draft

- **WHEN** device B saves a draft after device A read version 1, then A attempts to save with `If-Match: "v1"`
- **THEN** A receives `412 version_conflict`, version 2 remains intact, and A can choose to reload version 2 or save its local content as a different draft

#### Scenario: Stale discard

- **WHEN** a caller discards a draft using an old ETag
- **THEN** the draft remains and the API returns `412 version_conflict`

### Requirement: Archived-course draft access

A current member of an archived course SHALL be able to list, read, and discard their own existing drafts but SHALL NOT create or update a draft or publish it. Mutating attempts SHALL return `409 course_archived` without changing the draft or creating a post. A deleted or inaccessible course SHALL reveal no draft content.

#### Scenario: Archived course

- **WHEN** a course is archived after a draft was saved
- **THEN** its owner can read or discard the draft, but an update or publish attempt returns `409 course_archived`

### Requirement: Debounced composer autosave and draft management

The new-post composer SHALL offer an owner-visible way to reopen and discard multiple saved drafts and SHALL debounce text/metadata autosaves. It SHALL show saving, saved, error, and version-conflict states and SHALL not imply queued attachments are durable. Drafts SHALL remain private and absent from the course post feed until published.

Closing the composer or navigating within the app while a local text/metadata revision is unsaved or its save is pending SHALL be blocked until the latest revision is successfully saved. The blocked attempt SHALL show a visible saving/unsaved status; after success a subsequent attempt may leave without a discard prompt. If saving fails, the composer SHALL retain local content and offer Retry or an explicit Discard local changes action; it SHALL NOT silently abandon the revision. Device-local queued attachments still require an explicit discard confirmation when leaving.

#### Scenario: Reopen after reload

- **WHEN** a member edits a draft, waits for autosave success, reloads, and reopens it
- **THEN** the latest saved text and metadata return to the composer, with no attachment falsely restored

#### Scenario: Save failure

- **WHEN** an autosave fails
- **THEN** local content remains available with a retry action and an explicit unsaved indication

#### Scenario: Leave while save is pending

- **WHEN** a member tries to close or navigate away with an unsaved or in-flight draft revision
- **THEN** that attempt stays in the composer with a visible saving status; once the latest revision is saved, a new leave attempt succeeds without a text-discard prompt

#### Scenario: Leave after save failure

- **WHEN** the save fails while a member is trying to leave
- **THEN** the composer stays open with local text intact and explicit Retry and Discard local changes actions
