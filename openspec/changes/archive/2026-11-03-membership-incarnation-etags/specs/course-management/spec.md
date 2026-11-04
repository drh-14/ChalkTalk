## ADDED Requirements

### Requirement: Membership ETags distinguish leave and rejoin incarnations

Each active course membership SHALL have a unique immutable incarnation token. The API SHALL emit an opaque membership ETag containing that token and current membership version on join, detail, role update, and email-preference responses. The public membership ID and JSON version SHALL remain unchanged, and course ETags SHALL retain their current format. An idempotent join replay SHALL return its original response ETag, body, and status.

#### Scenario: Stale removal after rejoin

- **WHEN** an instructor reads a membership ETag, the member leaves and rejoins, and the instructor sends DELETE with the old ETag
- **THEN** the API returns `412 version_conflict` without removing the new membership

#### Scenario: Stale role or preference change after rejoin

- **WHEN** a conditional membership or preference PATCH supplies an ETag from a previous incarnation, including the legacy `"vN"` form
- **THEN** the API returns `412 version_conflict` without changing the current membership

#### Scenario: Fresh conditional write

- **WHEN** an authorized caller sends a current membership ETag for a valid change
- **THEN** the change succeeds and the next ETag contains the same incarnation and an increased version

#### Scenario: Missing precondition and self-leave

- **WHEN** an instructor omits `If-Match` for membership PATCH or DELETE
- **THEN** the API returns `428 precondition_required`
- **AND WHEN** a current member uses the voluntary self-leave endpoint
- **THEN** its existing no-ETag behavior remains unchanged
