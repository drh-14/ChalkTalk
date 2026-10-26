## ADDED Requirements

### Requirement: Instructors control future discussion behavior

Every course SHALL expose `allowAnonymousPosting`, `allowPrivatePosting`, and `allowFollowupResolution` as booleans on course create, list, get, and update responses. All three SHALL default to `true` for existing and new courses. Only a current instructor SHALL change them through the existing `PATCH /api/v1/courses/{courseId}` with CSRF and `If-Match`; a successful change SHALL advance the course version and ETag. A TA or student SHALL receive the existing non-instructor `404 not_found` behavior, invalid or empty updates `422 validation_failed`, missing ETag `428`, and stale ETag `412`.

#### Scenario: Instructor disables anonymity
- **WHEN** a current instructor conditionally patches `allowAnonymousPosting` to `false`
- **THEN** the response and a subsequent course read expose `false` with a newer ETag

#### Scenario: TA attempts a policy change
- **WHEN** a current TA patches any discussion switch with a valid ETag
- **THEN** the API returns `404 not_found` and the policy remains unchanged

#### Scenario: Course created after deployment
- **WHEN** an instructor creates a new course without policy fields
- **THEN** all three switches are `true`
