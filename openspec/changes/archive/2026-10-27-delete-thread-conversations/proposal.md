## Why

Members need to remove an entire informal Thread conversation, including replies and files, rather than leaving a deleted opening-message placeholder.

## What Changes

- Let the conversation starter or current course staff delete a whole conversation after a destructive confirmation.
- Reject stale deletion when the conversation has changed, and remove its messages, files, watches, unread state, and notifications atomically.
- Queue object cleanup and publish a durable live change so open clients refresh.

## Capabilities

### Modified Capabilities

- `public-course-threads`: Add whole-conversation deletion, authorization, versioning, and lifecycle behavior.

## Impact

Thread conversation schema and migration, REST contract, attachment and replay cleanup, WebSocket catch-up projections, browser controls, API/database references, and tests. No new service or dependency.
