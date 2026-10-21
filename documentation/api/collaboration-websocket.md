# Collaboration WebSocket protocol

Live sessions are edited over a WebSocket served by the collaboration server, a separate process that runs [Hocuspocus](https://tiptap.dev/docs/hocuspocus) and [Yjs](https://docs.yjs.dev). Answer and followup bodies are **not** edited over this WebSocket; they use version-checked REST saves described in the [answers and followups API reference](answers.md). No ticket can open an answer or followup.

## Connecting

1. Create a one-use ticket with [`POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets`](collaboration-sessions.md#createCollaborationConnectionTicket). The response contains `ticket`, `webSocketUrl`, `documentId`, and `expiresAt`.
2. Open `webSocketUrl`. It contains no credentials. The browser's `Origin` must exactly match a configured HTTPS frontend origin.
3. Join the document named `documentId` (`collaboration-session:{collaborationSessionId}`), sending `ticket` as the Hocuspocus authentication token.

The server consumes the ticket in the same database transaction that accepts the connection. A ticket is accepted only once, only before `expiresAt`, only for its own document, and only while its login session is valid, the course and session are active, and the user is still the creator, a current course TA or instructor, or a current invitee. Identity comes only from the ticket; the server never accepts a client-supplied user ID, role, or name.

## Document

Each session has one Yjs document with two shared types: the code text, `Y.Text('content')`, and the whiteboard, `Y.Map('whiteboard')`. The server rejects, before applying or broadcasting it, any update that writes another shared type, makes the text longer than 200,000 characters, or breaks a whiteboard rule below, and any message larger than 256 KiB. Title, language, and participants are REST resources, not part of the document.

The server persists the full Yjs state, the plain-text projection, and the whiteboard projection to PostgreSQL within 5 seconds of an accepted edit while editing continues, when the last participant disconnects, and when the session ends. Edits accepted within the last persistence interval can be lost if the collaboration server crashes. A reconnecting client always receives the most recently persisted state merged with its own unsaved local edits.

## Viewers

A ticket with `read` permission, issued to a participant invited as a viewer, opens a read-only connection. The viewer receives the document and other participants' presence live and may publish presence, but the server neither applies nor broadcasts their document updates, and the connection stays open.

## Whiteboard

`Y.Map('whiteboard')` maps each element's `id` to the whole element: an Excalidraw 0.18 element stored as a plain JSON object, never a nested Yjs type. Writes to different keys merge. For concurrent writes to one key, clients keep the copy with the higher `version`, then `versionNonce`, and write it back if Yjs kept the other. Deletion is soft: an element with `isDeleted: true` stays in the map.

For every entry an update adds or changes, the server requires:

- a JSON object whose `id` equals its key;
- `type` of `rectangle`, `ellipse`, `diamond`, `line`, `arrow`, `freedraw`, or `text` (no images, embeds, iframes, or frames);
- `link` absent, null, or an absolute `http` or `https` URL of at most 2,048 characters;
- no `fileId` and no `customData`;
- at most 64 KiB as JSON; for `freedraw`, a `points` array of at most 10,000 points; and at most 10,000 characters in `text` and `originalText`.

The map may hold at most 5,000 entries, counting soft-deleted ones, and the whole document may encode to at most 5 MiB. A rejected update closes the connection with `invalid-update`.

## Idle sessions

The collaboration server records when each session last had a connected participant: every sweep (15 seconds) while anyone is connected, and when the last participant disconnects. An active session with nobody connected for `COLLABORATION_IDLE_END_MINUTES` (default 120) ends as if its creator had ended it. A session with a connected participant never ends for inactivity.

## Presence

Clients publish cursor and selection positions through Yjs awareness. On the whiteboard they also publish `whiteboardPointer`: `{ x, y, tool, button }` in scene coordinates, with `tool` either `pointer` or `laser` and `button` either `up` or `down`, or `null` after leaving the whiteboard. Before applying or relaying any awareness update, the server overwrites each state's `user` field with `{ userId, name, color }` from the authenticated connection, so cursor and pointer labels always show the participant's real account display name. Sessions are private, so participants see each other's names even when the anchor post is anonymous.

## Server messages

Stateless messages are JSON strings:

| `type`            | Meaning                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presence`        | Sent once after connecting: `{ type, user: { userId, name, color } }`, the identity and color the server stamps on this client's presence for others. |
| `session-updated` | The session's title or language changed. Retrieve the session again and reconfigure the editor without reconnecting.                                  |
| `session-ended`   | The session ended. The connection then closes with reason `session-ended`.                                                                            |

## Closing

Hocuspocus reports a document-level close to the client with code `1000`; the reason string carries its meaning.

| Reason           | Meaning                                                                                       | Client action                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `session-ended`  | The session ended, went idle, or its course was archived or its post removed.                 | Show the final text read-only from the snapshot route. Do not reconnect.       |
| `access-removed` | The user was removed from the session, left or lost the course, or their login session ended. | Show an access-removed state. Do not reconnect.                                |
| `invalid-update` | The client sent an oversized message or an update outside the allowed document shape.         | Keep the local text visible as unsaved; reconnect with a new ticket to resync. |

An authentication failure is reported through the provider's authentication-failed event. Request a new ticket and try again only if the session is still visible and active.

## Reconnecting

Tickets are single-use. After any disconnect that is not one of the final reasons above, request a new ticket before reconnecting. Local edits made while disconnected merge into the document on reconnect if the user is still authorized and the session is still active.

Subchannel-anchored collaboration sessions are future work.
