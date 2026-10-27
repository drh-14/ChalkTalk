## Why

Course members need a lightweight place to find teammates and coordinate informal requests without turning each request into a structured Q&A post. The earlier private/category-based Threads proposal no longer matches the agreed public, staff-managed product.

## What Changes

- Add a **Threads** section beside Course resources with staff-created, course-public topic boards and separate member-started conversations.
- Add nonanonymous opening messages, chronological replies, edits, tombstones, and documents with current membership authorization.
- Add conversation watches, reply cards in the existing notification bell, per-message read state, unread badges, and live updates with conversation-local typing presence.
- Let staff rename and delete topic boards, with dependent content and files hidden and cleaned up; keep archived courses readable but not writable.
- Exclude categories, private membership, invitations, team rosters, search, email, and automatic archiving or deletion.

## Capabilities

### New Capabilities

- `public-course-threads`: Public topic boards, conversations, messages, attachments, watches, unread counts, notifications, and live presence.

### Modified Capabilities

None. Existing Posts, course resources, and their requirements remain unchanged.

## Impact

New PostgreSQL tables and migration; Express REST and authenticated WebSocket paths; object cleanup worker; in-app notification projection; course navigation and Threads UI; OpenAPI, API and database references; browser, API, database, and live-transport tests. No new infrastructure service or runtime dependency.
