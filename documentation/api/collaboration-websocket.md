# Collaboration WebSocket protocol

This is a future WebSocket contract; its ticket endpoints and Hocuspocus connections are not implemented. Current answer editing uses version-checked REST requests described in the [answers API reference](answers.md).

## Connecting

Request a one-use ticket before opening a connection.

`POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets` returns credentials for a temporary post or subchannel session.

The proposed `POST /api/v1/answers/{answerId}/collaboration-connection-tickets` endpoint would return credentials for an editable answer.

Configure the Hocuspocus provider with the returned credential-free `webSocketUrl`, `documentId` as its document name, and `ticket` as its token. A ticket expires five minutes after issuance and can be used once. Request a new ticket before reconnecting.

The proposed server accepts a connection only while the authenticated user retains access to the target. Current answer permissions and endorsement behavior are specified in the [answers API reference](answers.md).

## Shared documents and presence

Connected clients synchronize document changes using the standard Yjs protocol. Offline edits can be synchronized only while the user remains authorized to edit the target.

Presence is live-only. It reflects the authenticated participant and does not reveal a hidden author identity.

## Origin and transport policy

Production connections use `wss`. Plain `ws` is allowed only for local development. Browser connections must send an `Origin` that exactly matches a configured HTTPS frontend origin. The WebSocket URL must not contain a ticket, session cookie, user identifier, or other credential.

## Connection closure

The server uses these stable WebSocket close codes:

`1000`: Normal closure.

`1001`: Transient disconnect or server restart; request a fresh ticket and reconnect.

`1008`: Malformed request or generic protocol-policy violation.

`1011`: Internal server failure.

`4401`: Authentication failed because the ticket is invalid, expired, or already used.

`4403`: The user no longer has permission to access the target.

`4404`: The session or answer is no longer available for editing.

`4429`: The connection or ticket request was rate limited.

Application close reasons are safe to display as diagnostic text and do not reveal whether a hidden resource exists.
