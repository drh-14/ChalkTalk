## MODIFIED Requirements

### Requirement: Course deletion is durable and observable

The API SHALL return `202` and a `deleting` course when deletion begins. A durable job SHALL eventually remove course-owned records, including posts, post-tag links, and tags, before removing the course. A deleting course remains available for polling until cleanup completes. Cleanup SHALL be retry-safe.

#### Scenario: Deletion worker restarts

- **WHEN** the API process stops after accepting deletion of a course with posts and restarts
- **THEN** the persisted job resumes, removes the course's post and tag data, and the course eventually becomes `not_found`
