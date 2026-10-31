# public-course-threads Specification

## Purpose

Provide course members with public, staff-managed topic boards for informal group coordination through separate conversations, while preserving membership security and reliable unread state.

## Requirements

### Requirement: Staff manage public topic boards

The system SHALL provide a Threads section in the [course navigation](../course-discussion-frontend/spec.md). Current instructors and TAs SHALL be able to create and rename a Thread topic board. Every current course member SHALL be able to discover and read every board. Staff SHALL be able to delete a board after an explicit confirmation that its conversations and files will be lost; deletion SHALL hide all dependent content immediately and enqueue file cleanup. Boards SHALL have no category, private mode, invitation, join, search, archive, or inactivity expiration.

The browser SHALL reuse the same idempotency key when retrying an unchanged board creation after an uncertain outcome. Editing the title or successfully creating a board SHALL cause the next submission to use a new key.

#### Scenario: Student sees a board but cannot manage it

- **WHEN** a current student opens Threads and attempts board creation or renaming
- **THEN** the student can read listed boards but the mutation is denied without changing a board

#### Scenario: Staff deletes a board

- **WHEN** current staff confirms deletion of a board with conversations and files
- **THEN** the board, conversations, messages, watches, notifications, and files become unavailable to members and file cleanup is queued

#### Scenario: Board creation response is lost

- **WHEN** the browser retries the same title after the server created the board but its response was lost
- **THEN** the retry uses the original key and does not create another board

### Requirement: Members create conversations and chronological messages

Any current course member SHALL be able to start a conversation inside a board with a required nonanonymous opening Markdown message saved atomically with the conversation. A conversation SHALL have no independent title. Current members SHALL be able to read its flat chronological messages and add replies. The system SHALL NOT create a team roster or a course-wide bell or email notice for a new conversation; an authorized live change signal MAY refresh the board list. Message authors SHALL be able to edit and delete their own messages. Current staff SHALL additionally be able to edit and delete messages whose author was a student when posted, but SHALL NOT edit or delete another staff-authored message solely by virtue of staff role. An opening-message deletion SHALL leave a bodyless placeholder and preserve replies. Message mutations SHALL use versions so stale edits or deletes cannot overwrite newer state. Deleted text SHALL not be returned to readers.

The browser SHALL reuse the same idempotency key when retrying unchanged conversation or reply text after an uncertain outcome. Editing the text or successfully creating the content SHALL cause the next submission to use a new key.

#### Scenario: Conversation creation is atomic

- **WHEN** a current member submits a valid opening message
- **THEN** one conversation and its opening message are saved together, or neither is saved on failure

#### Scenario: Staff moderates a student contribution

- **WHEN** a current TA edits a message authored by a student at posting time
- **THEN** the edit succeeds regardless of the author's later role, subject to a current version precondition

#### Scenario: Staff cannot edit another staff contribution

- **WHEN** a TA tries to edit a different instructor-authored message
- **THEN** the mutation is denied and the message remains unchanged

#### Scenario: Opening message is deleted

- **WHEN** an authorized actor deletes a conversation's opening message
- **THEN** its text and attachments are hidden while a bodyless placeholder and later replies remain readable

#### Scenario: Conversation or reply response is lost

- **WHEN** a member retries unchanged text after its creation response was lost
- **THEN** the retry uses the original key and does not create duplicate content

### Requirement: Attachments obey message and membership access

An authorized message editor SHALL be able to upload a validated document or image through the API after the message has been saved. Upload failure SHALL not erase the saved message. Every metadata read and download SHALL require current course membership and an active, visible parent message. Removing a message or board SHALL immediately deny its file downloads and enqueue byte cleanup. Archived courses SHALL allow authorized downloads but no new upload or removal. The API SHALL deduplicate an upload retry with the same idempotency key and payload.

#### Scenario: Former member requests a file

- **WHEN** a user who left the course requests a Thread message attachment
- **THEN** the system denies access without disclosing file bytes or metadata

#### Scenario: Upload fails after message save

- **WHEN** object storage rejects an attachment upload after a reply is saved
- **THEN** the reply remains visible and the file can be retried independently through the API

#### Scenario: Attachment response is lost

- **WHEN** an API client retries the same file and idempotency key after its upload response was lost
- **THEN** the retry does not create a duplicate attachment

### Requirement: Watches, unread counts, and reply notifications are distinct

Starting or replying to a conversation SHALL establish a watch unless one already exists. An explicit follow SHALL enable reply notices, and an explicit unfollow SHALL disable them without deleting the watch or its per-message read state; posting again SHALL NOT silently re-enable notices. A new reply SHALL create an in-app notification in the existing bell for other current watchers whose notices are enabled, but SHALL send no email. New conversations SHALL not generate a course-wide alert. The Threads section SHALL show the sum of unread messages in watched conversations, each board SHALL show its subtotal, and each conversation SHALL show its unread count, including watches with notices disabled. Opening a conversation SHALL mark only messages loaded in that opening as read. Bell dismissal SHALL not change message read state.

#### Scenario: Unfollowed watcher receives a reply

- **WHEN** a member has explicitly unfollowed a watched conversation and another member replies
- **THEN** its unread count increases but no reply notification card or email is created for that member

#### Scenario: Opening a partial page

- **WHEN** a watcher opens a conversation and only the newest message page loads
- **THEN** only those loaded messages become read, leaving older unloaded messages and concurrent new replies unread

### Requirement: Threads are read-only in archived courses

Current members SHALL retain access to boards, conversations, messages, and permitted downloads in an archived course. Creation, editing, deletion, watch mutations, and attachment mutations SHALL be rejected until the course is active again. Course deletion SHALL remove dependent Thread records and queue file cleanup.

#### Scenario: Archived course blocks a reply

- **WHEN** a member attempts to reply in an archived course
- **THEN** the system rejects the write without creating a message or notification

### Requirement: Live updates recover through authoritative reads

The client SHALL use an authenticated live WebSocket connection for Thread changes. A committed change signal SHALL not contain message bodies or file details and SHALL prompt a membership-authorized REST catch-up. Initial load and reconnect SHALL use a durable cursor so missed or duplicate signals do not lose committed content; manual refresh SHALL remain available while disconnected. The server SHALL recheck membership before delivering a signal, and REST SHALL independently enforce authorization. No background polling is required.

#### Scenario: Client reconnects after missing a signal

- **WHEN** a member's socket disconnects while replies commit and later reconnects
- **THEN** REST catch-up after the last durable cursor returns the visible committed changes without duplicates

#### Scenario: Former member retains a socket

- **WHEN** course membership is revoked before a Thread change
- **THEN** the former member receives no authorized content through the socket or REST catch-up

### Requirement: Reply typing is ephemeral conversation-local presence

Only a member composing a reply in an open conversation SHALL produce a bounded typing pulse over the live authenticated WebSocket. Other currently connected clients viewing that same conversation SHALL see the member's session-derived display name in a transient “X is typing” indicator. Clients outside that conversation SHALL not receive the indicator. The system SHALL NOT store draft text, keystrokes, or presence as a message, unread count, bell notification, email, or catch-up record. Stop events or a short expiry SHALL remove stale presence.

#### Scenario: Two viewers share a conversation

- **WHEN** one member types in its reply composer while another member has the same conversation open
- **THEN** the second viewer sees the first member's name and the indicator expires after typing stops or a short timeout

#### Scenario: Viewer is elsewhere

- **WHEN** a member types a reply and another client views a different conversation
- **THEN** the other client receives no typing indicator

### Requirement: Authorized whole-conversation deletion

The conversation starter and current course instructors or TAs SHALL be able to delete the whole conversation after explicit confirmation, even when others have replied or attached files. Other members SHALL be denied. The API SHALL require a current conversation version precondition and SHALL reject stale deletion when messages or attachments have changed. Deletion SHALL atomically hide all messages, attachments, watches, unread state, and notification cards; queue file cleanup; prevent idempotent retries from restoring removed content; and publish a durable `conversation_deleted` change. Archived courses SHALL reject deletion.

#### Scenario: Starter deletes a conversation with others' replies

- **WHEN** the starter confirms deletion using the current conversation ETag
- **THEN** the conversation and all its messages, files, watches, unread counts, and notification cards disappear, and object cleanup is queued

#### Scenario: Staff moderates a conversation

- **WHEN** a current TA deletes a student-started conversation with the current ETag
- **THEN** the same complete deletion succeeds

#### Scenario: Nonstarter attempts deletion

- **WHEN** another student attempts deletion
- **THEN** the API denies the request without changing the conversation

#### Scenario: Stale confirmation

- **WHEN** a new reply or attachment changes a conversation after the viewer loaded it
- **THEN** deletion with the old ETag fails and the browser refreshes before another confirmation

#### Scenario: Archived course

- **WHEN** an authorized starter attempts deletion in an archived course
- **THEN** the API rejects the mutation and keeps all content

### Requirement: Threads browser attachment visibility

The Threads browser UI SHALL NOT offer an attachment picker for now. It SHALL continue to display links for previously uploaded attachments. The API attachment contract remains unchanged.

#### Scenario: Existing attachment remains available

- **WHEN** an authorized member opens a Threads message with an existing attachment
- **THEN** the attachment download link is visible, but no Attach file control is offered

### Requirement: Threads controls match course buttons

Threads action buttons SHALL retain the shared primary, secondary, and danger styling, including visible keyboard focus, but SHALL use approximately 20% smaller dimensions than their current enlarged Threads-specific size. Buttons elsewhere in the application SHALL not change.

#### Scenario: Threads actions are compact

- **WHEN** a member opens the Threads board and conversation views
- **THEN** action buttons in both views use the reduced dimensions without losing their distinct styling or focus indication
