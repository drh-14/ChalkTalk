## MODIFIED Requirements

### Requirement: Authorized editors obtain bounded one-use connection tickets

The authenticated API SHALL issue a five-minute, one-use ticket for a specific visible answer body only to a current member who can edit that body. It SHALL require the existing session, Origin, and CSRF protections; a ticket SHALL be bound to its session, user, answer ID. The WebSocket SHALL consume the ticket once, reject a mismatched document name, and not trust a client-claimed identity or role.

Each WebSocket SHALL be bound to one ticket identity and document. Unknown, multiplexed, or unauthenticated document frames SHALL be rejected. Before each outbound document frame is handed to the WebSocket, the server SHALL recheck PostgreSQL session, account, role, and target access under locks that conflict with revocation, keeping those locks through the synchronous send call. No document frame SHALL be handed to the WebSocket after the applicable revocation transaction commits; frames handed off before commit cannot be recalled. Outbound queues and socket buffers SHALL be bounded and fail closed on authorization or database errors.

#### Scenario: Valid editor joins

- **WHEN** an authorized current member requests a ticket and connects to its exact document before expiration
- **THEN** the ticket is consumed and the document is loaded from durable state

#### Scenario: Replay or mismatched document

- **WHEN** a ticket is reused or offered for another document
- **THEN** the connection is rejected without exposing content

#### Scenario: Session-suffixed or malformed document address

- **WHEN** an editor sends a NUL-suffixed, malformed, or alternate document address instead of the exact ticket-bound name
- **THEN** the connection is rejected without loading or disclosing document content

#### Scenario: Permission change before join

- **WHEN** membership or resource visibility changes between ticket issuance and connection
- **THEN** the connection is rejected

#### Scenario: Permission changes before queued or replicated egress

- **WHEN** a revocation commits before a queued, REST-refreshed, or Redis-replicated frame reaches an editor
- **THEN** that frame is not handed to the editor's WebSocket

### Requirement: Each accepted live update is durable before propagation

For both initial synchronization and subsequent updates, the server SHALL validate size, supported document structure, current session and editing permission, active course and target visibility, and commit the Yjs state, Markdown projection, revision, timestamps, and attribution in one PostgreSQL transaction before applying or broadcasting the update. Only `Y.Text('content')` SHALL be writable. The text SHALL be at most 100,000 characters; a temporary empty live value SHALL be allowed. Rejected updates SHALL not be broadcast or acknowledged as saved. Repeated updates that change no text SHALL not create attribution or a new content revision.

#### Scenario: Initial sync contains changes

- **WHEN** a client joins with an offline Yjs update and remains authorized
- **THEN** its SyncStep2 change is committed before it reaches other editors

#### Scenario: Role is revoked while connected

- **WHEN** a member loses edit permission before a subsequent update
- **THEN** that update is rejected and is absent from persisted and peer state

#### Scenario: Malformed or oversized update

- **WHEN** a client sends an invalid, unsupported, or over-limit update
- **THEN** the connection is rejected without a content change or broadcast

### Requirement: Multiple nodes converge on PostgreSQL authority

Authorized clients connected to different collaboration nodes SHALL observe accepted updates. Redis SHALL relay live updates but SHALL not be the durable document store. A node unable to confirm Redis health or PostgreSQL persistence SHALL stop accepting writes and disconnect affected clients; recovery SHALL reload PostgreSQL state and require fresh tickets. Missed notices SHALL be reconciled from durable revisions.

#### Scenario: Two nodes edit one document

- **WHEN** editors on different nodes make authorized concurrent changes
- **THEN** both nodes and PostgreSQL converge on both edits

#### Scenario: Redis outage

- **WHEN** Redis is unavailable to a collaboration node
- **THEN** the node rejects new edits before broadcast and requires fresh synchronization after recovery

### Requirement: Live editor preserves privacy and unsaved changes

The browser SHALL bind answer body editing to a shared text document and retain Markdown and LaTeX controls. It SHALL display connection and rejection states without labeling an unconfirmed local change “Saved”; rejected or disconnected local text SHALL remain copyable. Anonymous authors or contributors SHALL not be revealed to unauthorized peers through awareness.

#### Scenario: Concurrent browser editors

- **WHEN** two authorized editors type at different positions
- **THEN** each sees the converged text without a whole-body replacement

#### Scenario: Anonymous body

- **WHEN** students collaborate on anonymous content
- **THEN** peer presence does not reveal the anonymous editor identity

## ADDED Requirements

### Requirement: Followup bodies cannot join the live transport

The API SHALL NOT issue live tickets for followups or replies, and the WebSocket SHALL reject their document names without loading or disclosing content.

#### Scenario: Followup ticket request

- **WHEN** a member requests a followup collaboration ticket or connects to `followup:<uuid>`
- **THEN** the request is rejected without a ticket or body disclosure
