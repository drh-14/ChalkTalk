## ADDED Requirements

### Requirement: Course API follows the published contract

The system SHALL implement every operation in `documentation/api/courses.md` and the corresponding paths in `documentation/openapi.yaml`, including documented access rules, response envelopes, pagination, ETags, idempotency, validation, and errors.

#### Scenario: An organization member creates a course

- **WHEN** an authenticated user creates a valid course in their organization
- **THEN** the API returns `201`, a `Location`, an ETag, course details, and a join code, and the creator is its initial instructor

#### Scenario: A nonmember requests a course

- **WHEN** a signed in user requests a course without a membership
- **THEN** the API returns the documented hidden resource response

### Requirement: Membership API follows the published contract

The system SHALL implement every operation in `documentation/api/course-memberships.md` and the corresponding paths in `documentation/openapi.yaml`. It SHALL enforce the documented role permissions and prevent removal or demotion of the last instructor.

#### Scenario: A user joins with a valid course link

- **WHEN** any signed in user submits a valid course ID and eight character join code, including for a course in another organization
- **THEN** the API creates a student membership and returns the documented `201` response

#### Scenario: The final instructor would leave or be removed

- **WHEN** a mutation would leave an existing course without an instructor
- **THEN** the API returns `last_instructor` and retains the instructor membership

### Requirement: Membership identity preserves the agreed database key

The database SHALL use `(course_id, user_id)` as the membership primary key. The API SHALL return a stable opaque `id` derived from that pair without adding a surrogate database key.

#### Scenario: A membership is retrieved twice

- **WHEN** the same membership is returned through list and detail requests
- **THEN** both responses contain the same `id`

### Requirement: Course deletion is durable and observable

The API SHALL return `202` and a `deleting` course when deletion begins. A durable job SHALL eventually remove course owned records and the course. A deleting course remains available for polling until cleanup completes.

#### Scenario: Deletion worker restarts

- **WHEN** the API process stops after accepting a deletion and restarts
- **THEN** the persisted job resumes and the course eventually becomes `not_found`

### Requirement: Browser course flows use live API data

The protected browser experience SHALL list the user's courses and support create, join, detail, lifecycle, and role appropriate membership actions with loading, empty, error, and pending states. It SHALL send session credentials, CSRF, and conditional request headers according to the API contract.

#### Scenario: A signed in user has no courses

- **WHEN** the course list returns an empty page
- **THEN** the home page presents an empty state with create and join actions

#### Scenario: A course edit races another update

- **WHEN** a conditional browser mutation receives `version_conflict`
- **THEN** the browser refreshes the resource and offers the user a retry without silently overwriting the other edit

### Requirement: Course creation can discover the caller's organization

The system SHALL implement the existing documented `GET /api/v1/organizations` response for the authenticated user's direct organization association. It SHALL return only the documented organization fields and page envelope; it SHALL not introduce organization memberships.

#### Scenario: Discover the course creation organization

- **WHEN** an authenticated user requests organizations
- **THEN** the response contains their direct organization in the documented paginated envelope

### Requirement: Tests enforce course contracts

API integration and browser tests SHALL be derived from the API and database references and SHALL cover documented successes, headers, error rules, persistence invariants, and user visible course interactions.

#### Scenario: A contract behavior regresses

- **WHEN** an API response, database invariant, or browser interaction differs from the documented course behavior
- **THEN** the relevant automated test fails
