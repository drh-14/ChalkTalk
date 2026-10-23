# Content revision history delta

## MODIFIED Requirements

### Requirement: Authorized readers can inspect and compare revisions

The collection endpoint SHALL return at most 50 oldest-to-newest metadata records and a next cursor. Collection metadata SHALL exclude title and body text. Single and comparison endpoints SHALL query and return only the selected full snapshots after current visibility authorization.

#### Scenario: Large revision trail

- **WHEN** a reader requests a resource with more than 50 revisions
- **THEN** the first response contains at most 50 metadata records and a next cursor, and a subsequent cursor request yields the next records without loading full snapshot bodies
