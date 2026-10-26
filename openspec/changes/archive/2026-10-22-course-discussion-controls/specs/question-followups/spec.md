## ADDED Requirements

### Requirement: New followups and replies obey current anonymity policy

Creating a direct followup or nested reply with `anonymous: true` SHALL return `409 anonymous_posting_disabled` without writing content when course anonymity is disabled. Matching successful idempotent retries SHALL replay despite later policy changes. Existing anonymous followups and replies SHALL retain their display and edit permissions. Policy updates and creation SHALL have a deterministic serialized order.

#### Scenario: Anonymous reply after disablement
- **WHEN** a member creates an anonymous reply while anonymity is disabled
- **THEN** the API returns `409 anonymous_posting_disabled` and no reply is created

### Requirement: Resolution switch freezes markers without hiding them

When `allowFollowupResolution` is false, existing `resolved` values SHALL remain visible but `canResolve` SHALL be false and explicit resolve/reopen requests SHALL return `409 followup_resolution_disabled` without changing a marker. Creating a new reply SHALL not automatically clear a resolved marker while the switch is disabled. Re-enabling resolution SHALL restore normal explicit and automatic marker behavior for subsequent actions.

#### Scenario: Instructor disables resolution on a resolved discussion
- **WHEN** a member reads a resolved discussion while resolution is disabled
- **THEN** `resolved` remains true and `canResolve` is false

#### Scenario: Reply while resolution is disabled
- **WHEN** a member replies to a resolved discussion while resolution is disabled
- **THEN** the reply is created but the discussion remains resolved

#### Scenario: Explicit reopen while resolution is disabled
- **WHEN** an otherwise authorized member requests to reopen a resolved discussion while resolution is disabled
- **THEN** the API returns `409 followup_resolution_disabled` without changing the marker
