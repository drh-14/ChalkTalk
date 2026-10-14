# live-content-editing Specification

## Purpose
Lets authorized course members edit existing shared answer and followup bodies together while keeping accepted changes durable, synchronized, and identity-safe.

## Requirements

### Requirement: Authorized editors obtain bounded one-use connection tickets

The authenticated API SHALL issue a five-minute, one-use ticket for a specific visible answer or followup body only to a current member who can edit that body. It SHALL require the existing session, Origin, and CSRF protections; a ticket SHALL be bound to its session, user, document kind, and ID. The WebSocket SHALL consume the ticket once, reject a mismatched document name, and not trust a client-claimed identity or role.

#### Scenario: Valid editor joins
- **WHEN** an authorized current member requests a ticket and connects to its exact document before expiration
- **THEN** the ticket is consumed and the document is loaded from durable state

#### Scenario: Replay or mismatched document
- **WHEN** a ticket is reused or offered for another document
- **THEN** the connection is rejected without exposing content

#### Scenario: Permission change before join
- **WHEN** membership or resource visibility changes between ticket issuance and connection
- **THEN** the connection is rejected

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

The browser SHALL bind answer and followup body editing to a shared text document and retain Markdown and LaTeX controls. It SHALL display connection and rejection states without labeling an unconfirmed local change “Saved”; rejected or disconnected local text SHALL remain copyable. Anonymous authors or contributors SHALL not be revealed to unauthorized peers through awareness.

#### Scenario: Concurrent browser editors
- **WHEN** two authorized editors type at different positions
- **THEN** each sees the converged text without a whole-body replacement

#### Scenario: Anonymous body
- **WHEN** students collaborate on anonymous content
- **THEN** peer presence does not reveal the anonymous editor identity
