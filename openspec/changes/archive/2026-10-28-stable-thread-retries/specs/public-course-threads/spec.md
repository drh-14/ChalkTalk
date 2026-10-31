## MODIFIED Requirements

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

An authorized message editor SHALL be able to upload a validated document or image after the message has been saved. Upload failure SHALL not erase the saved message. Every metadata read and download SHALL require current course membership and an active, visible parent message. Removing a message or board SHALL immediately deny its file downloads and enqueue byte cleanup. Archived courses SHALL allow authorized downloads but no new upload or removal.

The browser SHALL reuse the same idempotency key when retrying the same selected file on the same message after an uncertain outcome. Selecting different file content or successfully uploading SHALL cause the next upload to use a new key.

#### Scenario: Former member requests a file

- **WHEN** a user who left the course requests a Thread message attachment
- **THEN** the system denies access without disclosing file bytes or metadata

#### Scenario: Upload fails after message save

- **WHEN** object storage rejects an attachment upload after a reply is saved
- **THEN** the reply remains visible and the file can be retried independently

#### Scenario: Attachment response is lost

- **WHEN** a member reselects and retries the same file after its upload response was lost
- **THEN** the retry uses the original key and does not create a duplicate attachment
