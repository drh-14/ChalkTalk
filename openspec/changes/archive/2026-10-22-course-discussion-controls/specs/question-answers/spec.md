## ADDED Requirements

### Requirement: New answers obey current course anonymity policy

An answer creation requesting `anonymous: true` SHALL return `409 anonymous_posting_disabled` without writing content when the course disallows anonymity. A matching successful idempotent retry SHALL continue to replay after a later policy change. Existing anonymous answers SHALL remain readable and editable under their existing authorization rules. A policy update and new answer creation SHALL have a deterministic serialized order.

#### Scenario: Anonymous answer after disablement
- **WHEN** a member creates an anonymous answer in a course with anonymity disabled
- **THEN** the API returns `409 anonymous_posting_disabled` and no answer is created

#### Scenario: Existing anonymous answer remains available
- **WHEN** anonymity is disabled after an answer was created anonymously
- **THEN** the answer retains its anonymous display and normal edit permission
