## ADDED Requirements

### Requirement: No answer or followup live transport

The API SHALL NOT issue collaboration tickets for answers, followups, or replies. No Hocuspocus server or Redis relay SHALL accept their body changes. Typing in a Markdown editor SHALL remain private to the local draft until the user explicitly saves it through the version-checked REST API.

#### Scenario: A member attempts the removed ticket route

- **WHEN** an authenticated member requests an answer or followup collaboration ticket
- **THEN** the route is unavailable and no ticket or body content is issued

#### Scenario: Two members type without saving

- **WHEN** two authorized members edit the same answer body in separate browsers without saving
- **THEN** neither draft is sent to the API or appears in the other's editor

### Requirement: Historical Yjs state is verified before removal

Before dropping answer-specific Yjs storage, migration SHALL decode every nonempty active answer document and compare its text with `answers.body_markdown`. The original empty marker SHALL be treated as unseeded and SHALL preserve the Markdown row. Corrupt or divergent state SHALL abort the migration without dropping documents or changing answer content, version, contributors, or endorsement history.

#### Scenario: Divergent binary state

- **WHEN** a historical Yjs document disagrees with the saved Markdown projection
- **THEN** migration aborts and retains both the document and answer row for reconciliation

#### Scenario: Matching or unseeded binary state

- **WHEN** all nonempty documents match the saved Markdown and all other documents use the original empty marker
- **THEN** migration preserves the Markdown rows and drops answer-only binary and ticket tables

## REMOVED Requirements

### Requirement: Existing answer bodies use document-bound single-use tickets

Removed because shared answer editing is save-only through version-checked REST; no answer WebSocket or ticket is issued.

### Requirement: Each accepted live update is durable before propagation

Removed because typing is local and only Save commits.

### Requirement: Collaboration nodes synchronize through Redis

Removed because no live answer transport remains.

### Requirement: Live editor preserves privacy and unsaved changes

Removed because drafts are private local editor state, not awareness state.

### Requirement: Followup bodies cannot join the live transport

Removed because the live transport is removed entirely.
