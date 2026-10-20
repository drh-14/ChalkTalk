# Collaboration WebSocket protocol

Live code sessions are edited over a WebSocket served by the collaboration server, a separate process that runs [Hocuspocus](https://tiptap.dev/docs/hocuspocus) and [Yjs](https://docs.yjs.dev). Answer and followup bodies are **not** edited over this WebSocket; they use version-checked REST saves described in the [answers and followups API reference](answers.md). No ticket can open an answer or followup.

## Connecting

1. Create a one-use ticket with [`POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets`](collaboration-sessions.md#createCollaborationConnectionTicket). The response contains `ticket`, `webSocketUrl`, `documentId`, and `expiresAt`.
2. Open `webSocketUrl`. It contains no credentials. The browser's `Origin` must exactly match a configured HTTPS frontend origin.
3. Join the document named `documentId` (`collaboration-session:{collaborationSessionId}`), sending `ticket` as the Hocuspocus authentication token.

The server consumes the ticket in the same database transaction that accepts the connection. A ticket is accepted only once, only before `expiresAt`, only for its own document, and only while its login session is valid, the course and session are active, and the user is still the creator, a current course TA or instructor, or a current invitee. Identity comes only from the ticket; the server never accepts a client-supplied user ID, role, or name.

## Document

Each session has one Yjs document with a single shared text field, `Y.Text('content')`. The server rejects, before applying or broadcasting it, any update that writes another shared type or makes the text longer than 200,000 characters, and any message larger than 256 KiB. Title, language, and participants are REST resources, not part of the document.

The server persists the full Yjs state and the plain-text projection to PostgreSQL within 5 seconds of an accepted edit while editing continues, when the last participant disconnects, and when the session ends. Edits accepted within the last persistence interval can be lost if the collaboration server crashes. A reconnecting client always receives the most recently persisted state merged with its own unsaved local edits.

## Presence

Clients publish cursor and selection positions through Yjs awareness. Before applying or relaying any awareness update, the server overwrites each state's `user` field with `{ userId, name, color }` from the authenticated connection, so a cursor label always shows the participant's real account display name. Sessions are private, so participants see each other's names even when the anchor post is anonymous.

## Server messages

Stateless messages are JSON strings:

| `type`            | Meaning                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `session-updated` | The session's title or language changed. Retrieve the session again and reconfigure the editor without reconnecting. |
| `session-ended`   | The session ended. The connection then closes with reason `session-ended`.                                           |

## Closing

Hocuspocus reports a document-level close to the client with code `1000`; the reason string carries its meaning.

| Reason           | Meaning                                                                                       | Client action                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `session-ended`  | The session ended, or its course was archived or its post removed.                            | Show the final text read-only from the snapshot route. Do not reconnect.       |
| `access-removed` | The user was removed from the session, left or lost the course, or their login session ended. | Show an access-removed state. Do not reconnect.                                |
| `invalid-update` | The client sent an oversized message or an update outside the allowed document shape.         | Keep the local text visible as unsaved; reconnect with a new ticket to resync. |

An authentication failure is reported through the provider's authentication-failed event. Request a new ticket and try again only if the session is still visible and active.

## Reconnecting

Tickets are single-use. After any disconnect that is not one of the final reasons above, request a new ticket before reconnecting. Local edits made while disconnected merge into the document on reconnect if the user is still authorized and the session is still active.

Subchannel-anchored collaboration sessions are future work.
