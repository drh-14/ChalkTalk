## ADDED Requirements

### Requirement: Confirmed duplicate sources are hidden from ordinary discovery

Course lists SHALL exclude confirmed duplicate sources from ordinary listings and searches before ranking and pagination, including Related questions searches. Suggested duplicates SHALL remain visible. Only TAs and instructors MAY request `duplicateStatus=confirmed`; this staff review list SHALL contain only source ID, course ID, type, title, canonical ID and title, status, and version, not source body or author identity.

#### Scenario: Confirmed source matches full-text search

- **WHEN** a member searches for terms found in a confirmed duplicate source
- **THEN** that source is absent from results and does not affect pagination or `hasMore`

### Requirement: Staff can merge and unmerge text posts safely

Staff SHALL be able to confirm and unmerge duplicates using conditional PATCH. Confirmation SHALL retain source text in storage but return only ID, course ID, canonical ID, confirmed status, and version. A direct GET by a current course member SHALL respond `303` to the canonical post with no-store caching and without source text; nonmembers SHALL receive `404`. Confirmed sources SHALL reject ordinary edit/delete until unmerged. A canonical with confirmed inbound sources SHALL reject deletion or merging until those sources are unmerged. Canonical targets SHALL be active, unmerged, and in the same course.

#### Scenario: A staff member confirms a source

- **WHEN** a TA confirms an active source as duplicate of an active same-course canonical
- **THEN** its original text is retained, the response contains only the canonical reference, ordinary search excludes it, and its old URL redirects to the canonical URL

#### Scenario: A canonical has inbound confirmed sources

- **WHEN** a caller attempts to delete or merge the canonical
- **THEN** the API returns `409 canonical_has_duplicates` until staff unmerge the referring sources

#### Scenario: Staff unmerge a source

- **WHEN** staff clear the duplicate fields with the current ETag
- **THEN** the original title and body become visible again in direct reads and course search
