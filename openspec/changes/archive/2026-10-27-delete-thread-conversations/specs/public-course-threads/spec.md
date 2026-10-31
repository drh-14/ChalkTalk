## ADDED Requirements

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
