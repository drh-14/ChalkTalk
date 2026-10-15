# Collaboration WebSocket protocol

Answer and followup body editing uses the implemented Hocuspocus/Yjs WebSocket. Temporary collaboration sessions described elsewhere remain future work. Version-checked REST editing is still available as a fallback; see the [answers and followups API reference](answers.md).

## Connecting

Request a one-use ticket before opening a connection.

Call `POST /api/v1/answers/{answerId}/collaboration-ticket` or `POST /api/v1/followups/{followupId}/collaboration-ticket` with a session cookie, allowed Origin, CSRF token, `Content-Type: application/json`, and `{}`. Configure the Hocuspocus provider with the returned `documentName`, `ticket` token, and credential-free `/collaboration` WebSocket URL. The one-use ticket expires five minutes after issuance; request a new ticket before each reconnect. The server checks the current session and edit role on ticket consumption and every incoming update.

The separate collaboration process and Redis bus are opt-in. Start them together with the API and PostgreSQL; Redis is not a durable document store. If collaboration is down, use the version-checked REST editor.

Each socket accepts one ticket identity and one document. Initial document load is authorized atomically with the load transaction, and incoming sync requests as well as updates are reauthorized. Outbound frames are ordered through a bounded queue; PostgreSQL access locks remain held through each synchronous WebSocket send. A document frame is not handed to the WebSocket after a conflicting revocation transaction commits, including frames from REST refresh or Redis replication. Frames handed off before commit cannot be recalled. Unknown or multiplexed frames, queue overflow, and database authorization failures close the socket.

## Shared documents and presence

Connected clients synchronize document changes using the standard Yjs protocol. Offline edits can be synchronized only while the user remains authorized to edit the target.

This phase does not publish named presence or cursors. Client-supplied awareness identity is discarded, including for anonymous content.

## Origin and transport policy

Production connections use `wss`. Plain `ws` is allowed only for local development. Browser connections must send an `Origin` that exactly matches a configured HTTPS frontend origin. The WebSocket URL must not contain a ticket, session cookie, user identifier, or other credential.

## Connection closure

The server fails closed on invalid tickets, revoked permission, invalid updates, PostgreSQL failure, or Redis failure. Authentication and role failures use Hocuspocus's generic `permission-denied` protocol response rather than a guaranteed application WebSocket close code. A rejected update sends the Hocuspocus reset/close message (normally `4205`); oversized WebSocket frames may close with `1009`, and idle unauthenticated connections may close with `4408`. Do not infer the exact failure cause from the transport code or expose a hidden target. The earlier proposed custom `4401`/`4403`/`4404`/`4429` contract is **not** implemented in this phase.

Clients must not interpret local Yjs text or a successful WebSocket send as a durable save; only a server-accepted update is durable. Copy any local draft before closing a disconnected editor. On reconnection, request a new one-use ticket and reload the PostgreSQL-backed document. Temporary collaboration sessions have a separate, still-unimplemented contract.
