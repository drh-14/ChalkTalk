## Context

PR #91 already provides board deletion and per-message tombstones. A conversation has no version or delete endpoint, and its rows cascade through messages, watches, reads, attachments, and notification records.

## Decision

Store a creator ID and version on each conversation. Its `If-Match` value changes on replies, message edits/deletes, and attachment changes. Under course → board → conversation locks, authorize the creator or current staff, verify the precondition, queue deduplicated file-cleanup jobs, scrub keyed create replays, delete the conversation row, and append a `conversation_deleted` change. The existing foreign-key cascade purges dependent records. The browser confirms the loss of others' contributions and returns to the board after success; a 412 refreshes current state without deleting anything.

## Rejected alternative

Deleting only the opening message leaves replies behind and does not match the requested whole-conversation action.
