## Purpose

Provides a private, durable CRDT document boundary for an active answer so a future authenticated editing transport can load and persist concurrent text changes safely.

## ADDED Requirements

### Requirement: Active answers have a durable Yjs text document

The core SHALL load an active answer's document as encoded Yjs state with `Y.Text('content')`, its Markdown text, answer version, and persistence revision. It SHALL seed an existing empty state from `answers.body_markdown` once. A later load SHALL preserve stored CRDT history and SHALL not reseed. An absent, deleted, endorsed, closed, finalizing, or inactive-course answer SHALL not be loadable.

#### Scenario: Existing answer is loaded twice

- **WHEN** the core loads an active answer whose document has the empty marker and loads it again
- **THEN** both loads expose its original Markdown text and the second load preserves the first load's encoded state and revisions

#### Scenario: Inactive answer is loaded

- **WHEN** the core loads an endorsed answer or an answer in an inactive course
- **THEN** it rejects the load without changing document or answer rows

### Requirement: Updates merge and persist atomically

The core SHALL apply a valid encoded Yjs update against the latest stored state while serializing concurrent writes. It SHALL durably save the resulting binary state and valid Markdown projection in one transaction before reporting success. A changed binary state SHALL increment the persistence revision and timestamp; a changed Markdown projection SHALL also increment the answer version and timestamp. Replaying an update that changes no binary state SHALL change no revisions or timestamps. The core SHALL not change contributors without an authenticated editor identity.

#### Scenario: Concurrent edits from earlier state

- **WHEN** two independent Yjs clients submit compatible updates based on the same earlier document
- **THEN** the saved state contains both edits and the answer Markdown matches its text projection

#### Scenario: Duplicate update

- **WHEN** the same encoded update is applied twice
- **THEN** the second application leaves persisted state, revisions, and timestamps unchanged

#### Scenario: Binary state changes without Markdown change

- **WHEN** a valid update changes CRDT state but not `Y.Text('content')`
- **THEN** only the persistence revision and timestamp advance

### Requirement: Invalid or inactive writes cannot change answer content

The core SHALL reject encoded updates that are malformed, empty, or larger than 16 MiB and any resulting Markdown that is blank, whitespace-only, or longer than 100,000 characters. It SHALL reject updates when the answer is deleted or endorsed, the document is not active, or the course is inactive. It SHALL detect a nonempty persisted binary state whose text disagrees with `answers.body_markdown` as an integrity error. Rejected operations SHALL leave binary state, projection, revisions, and contributors unchanged.

#### Scenario: Malformed update

- **WHEN** a caller supplies an invalid Yjs update
- **THEN** the core rejects it and saves no changes

#### Scenario: Endorsement races an edit

- **WHEN** answer endorsement and a document update occur concurrently
- **THEN** row locks order them so an accepted edit is durable before endorsement or the later edit is rejected

#### Scenario: Projection mismatch

- **WHEN** a stored nonempty Yjs document disagrees with the answer Markdown
- **THEN** the core reports an integrity error without overwriting either representation
