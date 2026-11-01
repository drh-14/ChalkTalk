## Why

Live collaboration is bound to individual discussion posts, so post changes can end a session and course members cannot coordinate independently of a question. Course-level sessions provide a dedicated, private Collaboration area without replacing the existing editor or document store.

## What Changes

- **BREAKING:** Create and list collaboration sessions by course, not post; remove post anchors, post-scoped listing, and post-to-discussion actions.
- Show a Collaboration tab next to Threads, listing only sessions where the current member participates.
- Permit any current course member to create a session and any current participant to invite another member with immediate View/Edit access. Reserve management and removal for the creator or participating staff; honor View permissions for staff.
- Preserve existing session IDs, Yjs documents, participants, and roles during migration; detach post lifecycle and end a session when its creator leaves the course.
- Record whether final snapshot persistence was confirmed; warn on unconfirmed and historically ended snapshots.
- Verify database, HTTP, WebSocket, email, browser, network-loss, and concurrent-revocation behavior.

## Capabilities

### New Capabilities

- `course-collaboration-sessions`: Course-level session discovery, membership, lifecycle, live authorization, migration, and UI.

### Modified Capabilities

None.

## Impact

Collaboration schema and migration, API/service/worker, Hocuspocus server, course/account/post lifecycle, frontend routes/components, OpenAPI and database documentation, and integration/browser tests. No new runtime dependency.
