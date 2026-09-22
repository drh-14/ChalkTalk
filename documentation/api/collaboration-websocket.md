# Collaboration WebSocket protocol

ChalkTalk collaboration uses Yjs through Hocuspocus. The client and server must use compatible Hocuspocus versions. REST endpoints create sessions, issue connection tickets, and expose text snapshots; WebSocket frames use the standard Yjs/Hocuspocus protocol and are not described by OpenAPI.

## Connecting

The client first creates a one-use connection ticket with `POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets`. It then configures the Hocuspocus provider with:

- the credential-free `webSocketUrl` returned by the endpoint;
- `name` set to the returned `documentId`;
- `token` set to the returned `ticket`.

The server authenticates the ticket in Hocuspocus `onAuthenticate` before sending document state. A ticket is an opaque secret, expires five minutes after issuance, and is atomically consumed on the first authentication attempt. Ticket state binds its ticket ID, user ID, REST authentication session ID, collaboration session and document, course ID, effective permission, issue time, and expiry time. Invalid, expired, or replayed tickets fail authentication.

On connection, and periodically or after a known membership or permission revocation, the server rechecks the REST session, course membership, effective permission, collaboration-session status, and document binding. Reconnection requires a fresh ticket.

## Shared document and presence

Each collaboration document has one `Y.Text('content')` value. On connection or reconnection, normal Yjs state-vector synchronization merges the server and client states. A client may retain local offline edits, but the server accepts them only while the user still has write permission.

Yjs awareness is ephemeral and is not persisted in the document snapshot. The server overwrites client-supplied identity and role awareness fields with authenticated values. Live presence is named even when the user's attached post, answer, followup, or message is anonymous.

## Persistence

Hocuspocus hooks persist the binary Yjs document state in PostgreSQL. Writes use an approximately two-second debounce with a bounded maximum delay so continuous editing is still persisted. The server stores and restores the binary Yjs state directly; it must not reconstruct the document from JSON or plain text.

Ending a session follows this order:

1. Reject new connection-ticket requests and mark the session internally as ending.
2. Stop accepting new writes.
3. Drain accepted updates and perform a forced final persistence flush.
4. Mark the session ended in PostgreSQL.
5. Revoke unused tickets and close connected clients.

If the final flush fails, the REST end request returns `503 Service Unavailable`, the session remains active, and clients may reconnect with a fresh ticket. A snapshot of an ended session always represents the successful final flush.

## Origin and transport policy

Production connections use `wss`. Plain `ws` is allowed only for local development. Browser connections must send an `Origin` that exactly matches the deployment's allowlist of HTTPS frontend origins; missing, null, and disallowed origins are rejected before ticket authentication. The URL must not contain the ticket, session cookie, user identifier, or other credential.

## Connection closure

The server uses these stable WebSocket close codes:

- `1000`: normal closure.
- `1001`: transient disconnect or server restart; request a fresh ticket and reconnect.
- `1008`: malformed request or generic protocol-policy violation.
- `1011`: internal server or persistence failure.
- `4401`: authentication failed because the ticket is invalid, expired, or replayed.
- `4403`: permission or course membership was lost.
- `4404`: the collaboration session ended or the document is missing.
- `4429`: the connection or ticket attempt was rate limited.

Application close reasons are safe for display as diagnostic text and must not reveal whether a hidden course, session, or document exists.
