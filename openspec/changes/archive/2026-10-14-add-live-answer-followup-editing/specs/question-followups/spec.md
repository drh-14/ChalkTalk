## ADDED Requirements

### Requirement: Followup bodies have durable Yjs documents

Every existing and newly created root followup and reply SHALL have a Yjs document containing the current body as `Y.Text('content')`. Initial backfill SHALL preserve body text and revision. Conditional REST edits SHALL update the same durable document and notify open collaboration nodes; stale `If-Match` SHALL still return `412`. Deletion or loss of visibility SHALL close editing and prevent new document loads. A temporarily empty live body SHALL remain readable with a placeholder and SHALL not be treated as a deleted tombstone.

#### Scenario: Existing followup migrates

- **WHEN** an existing followup is loaded for live editing after migration
- **THEN** its Yjs text equals its pre-migration Markdown body

#### Scenario: REST reply creation followed by live body editing

- **WHEN** a member creates a reply through REST and its author or current staff edits its existing body live
- **THEN** the edit updates the reply's durable Yjs state and Markdown projection without creating another reply

#### Scenario: REST/live race

- **WHEN** REST and live edits race on a followup body
- **THEN** their writes serialize on the durable document and a stale REST precondition is rejected

#### Scenario: Deleted parent

- **WHEN** a followup becomes a bodyless tombstone
- **THEN** no editor can read or update its former body
