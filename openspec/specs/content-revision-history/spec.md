# Content Revision History Specification

## Purpose

Preserve and expose a privacy-safe, recoverable history of text changes to course posts and discussions without altering their nontext state or existing conditional-save behavior.

## Requirements

### Requirement: Every live text resource has an immutable revision trail

The system SHALL record the initial text of each newly created post, answer, root followup, and reply. A post revision SHALL contain its title and body Markdown; an answer or followup revision SHALL contain its body Markdown. Each successful text-changing save SHALL append exactly one immutable snapshot in the same transaction as the resource update. A metadata-only operation, attachment mutation, vote, resolution change, or text-identical save SHALL NOT append a text revision. The existing resource version and ETag rules SHALL remain authoritative even when revision numbers have gaps relative to resource versions.

#### Scenario: Create and edit a post

- **WHEN** a member creates a post and then changes its title with a conditional save
- **THEN** history has an initial snapshot and one later snapshot containing the new title and current body

#### Scenario: Nontext mutation

- **WHEN** a member adds an attachment or staff changes a post's pin state without changing text
- **THEN** no text revision is appended even if the resource ETag advances

#### Scenario: Existing content at deployment

- **WHEN** migration encounters a currently live post, answer, root followup, or reply
- **THEN** it creates exactly one baseline of current text without attributing an unknown historical editor; it does not reconstruct earlier states

### Requirement: Authorized readers can inspect and compare revisions

For each content type, a current member who can read the active resource SHALL be able to list its text revisions, retrieve a revision, and compare any two revisions of that same resource. The JSON list API SHALL return up to 50 oldest-to-newest metadata records in `{data:[...],page:{nextCursor}}`, with a cursor for further pages. List metadata SHALL contain revision identifier, ordinal, resource version at capture, timestamp, audit metadata, and identity-safe editor projection, but SHALL NOT contain title or body text. A single-revision read SHALL return the selected full text state, and comparison SHALL return only the two selected full text states for side-by-side or diff presentation; neither read SHALL load the entire history. History responses SHALL use `Cache-Control: private, no-store`. Anonymity at capture time SHALL determine each revision's editor projection: only current course staff SHALL see editor identities for revisions captured while anonymous, even if the resource later becomes nonanonymous; student readers, including contributors, SHALL see no identifying editor data for those revisions. A deleted editor account SHALL not expose an ID. A current reader SHALL be able to inspect history in an archived course, but not restore it.

#### Scenario: Compare revisions of an anonymous answer

- **WHEN** a student who can read an anonymous answer compares its revisions
- **THEN** both text states are visible and editor identities are redacted

#### Scenario: Staff audit anonymous content

- **WHEN** current course staff read the same history
- **THEN** active editor identities are visible, while an unknown baseline editor and a deleted account are not falsely identified

#### Scenario: Invalid comparison

- **WHEN** either requested revision does not belong to that resource
- **THEN** comparison returns `404 not_found` without exposing another resource's text

#### Scenario: Large revision trail

- **WHEN** an authorized reader requests history for a resource with more than 50 revisions
- **THEN** the API returns at most 50 metadata records and a cursor to the next page, without loading or returning revision text until a revision is selected or compared

### Requirement: History obeys current visibility and lifecycle rules

History SHALL use current course membership and current post-audience visibility, not access at the time of a revision. The API SHALL return the same `404 not_found` for absent, cross-course, unauthorized private, deleted, and confirmed-merged resources. Ordinary readers SHALL not obtain confirmed-merged source history through its canonical post. Unmerging SHALL make retained history available again to readers authorized for the unmerged source. Deleting an individual answer or followup SHALL purge its history; deleting a post SHALL purge the post's and all nested answer/followup histories, including histories of retained tombstones. Deleting an account SHALL redact its identity from retained revisions. No history endpoint SHALL resurrect deleted text.

#### Scenario: Member removed from a private audience

- **WHEN** a former audience member requests history after losing access
- **THEN** the request returns `404 not_found`, including for revisions created while access was held

#### Scenario: Deleted followup with children

- **WHEN** a followup is deleted but its bodyless tombstone remains to hold replies
- **THEN** its revision history is purged and inaccessible while live replies retain their own authorized histories

#### Scenario: Confirmed duplicate and unmerge

- **WHEN** a source post is confirmed as a duplicate
- **THEN** its history is hidden from ordinary routes, and after unmerge its retained revisions are again readable by authorized members

### Requirement: Staff can restore prior text conditionally and auditably

Current TAs and instructors SHALL be able to restore a revision of an active, visible resource in an active course with a current resource `If-Match`. Restore SHALL validate target text against current text rules, replace only post title/body or answer/followup body Markdown, and append a new revision recording the staff editor and source revision. It SHALL preserve current attachments, audience, anonymity, poll options and ballots, duplicate/pin/resolution state, and other nontext fields. An answer whose restored body changes SHALL clear current endorsement under the existing text-edit rule while retaining endorsement events. A successful restore SHALL return the updated resource, new ETag, and no-store cache policy. Missing or stale `If-Match` SHALL return `428 precondition_required` or `412 version_conflict`; a student SHALL receive `403 permission_denied`; an archived course SHALL return `409 course_archived`; hidden/deleted/merged resources or missing/foreign revision SHALL return `404 not_found`. Failed restores SHALL change neither resource nor history.

Answer restore authority SHALL not be limited by the ordinary answer edit-role floor. Restore SHALL record its editor in revision history without adding or modifying answer contributors or contribution events; ordinary edits retain contributor tracking. An explicit restore of identical text SHALL still append an auditable revision and advance the ETag; it SHALL preserve an existing answer endorsement when the body is unchanged.

#### Scenario: Restore text after attachment change

- **WHEN** staff restore an earlier post text revision using the current ETag after a newer attachment was added
- **THEN** only title/body change, the attachment remains, resource ETag advances, and a new revision records the restore

#### Scenario: Stale restore

- **WHEN** two staff attempt restores with the same ETag
- **THEN** at most one succeeds and the other receives `412 version_conflict` without appending a revision

#### Scenario: Restore in archived course

- **WHEN** staff attempt to restore text while the course is archived
- **THEN** the request returns `409 course_archived` and history remains unchanged

### Requirement: Revision history is accessible in the discussion interface

The post and discussion interface SHALL offer authorized readers a history entry point, chronological text versions, a way to reveal the saved title/body of any selected version (including a sole version), and a comparison view; it SHALL show staff-only restore controls with confirmation and visible stale-version/error handling. It SHALL not reveal anonymous editor identities in student views or show history controls for content the viewer cannot currently read. Restoring SHALL refresh the displayed text and ETag without replacing attachments or other nontext state.

#### Scenario: Student views anonymous revision

- **WHEN** a student opens history and compares two versions of an anonymous reply
- **THEN** text differences are visible without editor identities or a restore action

#### Scenario: Staff restore conflicts

- **WHEN** staff confirm restore after the resource changes elsewhere
- **THEN** the interface retains the chosen revision and displays an explicit conflict rather than silently overwriting newer text
