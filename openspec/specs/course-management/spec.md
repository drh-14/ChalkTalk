# course-management Specification

## Purpose

Define durable, membership-aware course management APIs and browser workflows for ChalkTalk.

## Requirements

### Requirement: Course API follows the published contract

The system SHALL implement every operation in `documentation/api/courses.md` and the corresponding paths in `documentation/openapi.yaml`, including documented access rules, response envelopes, pagination, ETags, idempotency, validation, and errors. It SHALL reject an empty idempotency key and SHALL allow a key to represent a new request once its 24-hour record has expired.

#### Scenario: An organization member creates a course

- **WHEN** an authenticated user creates a valid course in their organization
- **THEN** the API returns `201`, a `Location`, an ETag, course details, and a join code, and the creator is its initial instructor

#### Scenario: A nonmember requests a course

- **WHEN** a signed in user requests a course without a membership
- **THEN** the API returns the documented hidden resource response

#### Scenario: Retrying after expiry

- **WHEN** a client reuses an idempotency key after its previous record expired
- **THEN** the operation executes again and retains the new response for subsequent matching retries

### Requirement: Membership API follows the published contract

The system SHALL implement every operation in `documentation/api/course-memberships.md` and the corresponding paths in `documentation/openapi.yaml`. It SHALL enforce the documented role permissions and prevent removal or demotion of the last instructor. It SHALL require instructor access for `DELETE /courses/{courseId}/members/{userId}` even when `userId` is the caller. Self-leave SHALL use `/members/me`.

#### Scenario: A user joins with a valid course link

- **WHEN** any signed in user submits a valid course ID and eight character join code, including for a course in another organization
- **THEN** the API creates a student membership and returns the documented `201` response

#### Scenario: The final instructor would leave or be removed

- **WHEN** a mutation would leave an existing course without an instructor
- **THEN** the API returns `last_instructor` and retains the instructor membership

#### Scenario: Student addresses their own explicit membership URL

- **WHEN** a student calls the instructor-only member deletion operation for their own user ID
- **THEN** the operation returns the documented hidden-resource error and does not remove the membership

### Requirement: Membership identity preserves the agreed database key

The database SHALL use `(course_id, user_id)` as the membership primary key. The API SHALL return a stable opaque `id` derived from that pair without adding a surrogate database key.

#### Scenario: A membership is retrieved twice

- **WHEN** the same membership is returned through list and detail requests
- **THEN** both responses contain the same `id`

### Requirement: Course deletion is durable and observable

The API SHALL return `202` and a `deleting` course when deletion begins. A durable job SHALL eventually remove course-owned records, including posts, post-tag links, and tags, before removing the course. A deleting course remains available for polling until cleanup completes. Cleanup SHALL be retry-safe.

#### Scenario: Deletion worker restarts

- **WHEN** the API process stops after accepting deletion of a course with posts and restarts
- **THEN** the persisted job resumes, removes the course's post and tag data, and the course eventually becomes `not_found`

### Requirement: Browser course flows use live API data

The protected browser experience SHALL list the user's courses and support create, join, detail, lifecycle, and role appropriate membership actions with loading, empty, error, and pending states. It SHALL send session credentials, CSRF, and conditional request headers according to the API contract. It SHALL derive caller permissions from their direct membership resource, page through course and membership collections, and provide recoverable loading/error states.

#### Scenario: A signed in user has no courses

- **WHEN** the course list returns an empty page
- **THEN** the home page presents an empty state with create and join actions

#### Scenario: A course edit races another update

- **WHEN** a conditional browser mutation receives `version_conflict`
- **THEN** the browser refreshes the resource and offers the user a retry without silently overwriting the other edit

#### Scenario: Instructor is not on the first roster page

- **WHEN** the caller's instructor membership is beyond the first roster page
- **THEN** instructor controls remain available and the roster can load subsequent pages

### Requirement: Course creation can discover the caller's organization

The system SHALL implement the existing documented `GET /api/v1/organizations` response for the authenticated user's direct organization association. It SHALL return only the documented organization fields and page envelope; it SHALL not introduce organization memberships.

#### Scenario: Discover the course creation organization

- **WHEN** an authenticated user requests organizations
- **THEN** the response contains their direct organization in the documented paginated envelope

### Requirement: Tests enforce course contracts

API integration and browser tests SHALL be derived from the API and database references and SHALL cover documented successes, headers, error rules, persistence invariants, and user visible course interactions. Automated tests SHALL assert the implemented course, membership, organization, and shared idempotency database fields and affected API behaviors against `documentation/database.md` and the API references.

#### Scenario: A contract behavior regresses

- **WHEN** an API response, database invariant, or browser interaction differs from the documented course behavior
- **THEN** the relevant automated test fails

#### Scenario: Database shape drifts

- **WHEN** a documented type, key, state, or normalization constraint changes unintentionally
- **THEN** a PostgreSQL-backed test fails

### Requirement: Instructors cannot administer their own membership through member-management actions

An authenticated instructor SHALL NOT change their own course role or remove their own membership through the instructor-only `PATCH` or explicit `DELETE /courses/{courseId}/members/{userId}` operations. For an existing self-targeted membership with valid authorization and preconditions, each operation SHALL return `403 permission_denied` without changing the membership; this applies even to a no-op role update. Existing hidden-resource, missing-precondition, and stale-precondition responses SHALL retain their precedence. These operations SHALL continue to administer other members under the documented permissions. The distinct `DELETE /courses/{courseId}/members/me` operation SHALL remain the supported self-leave route, retaining its current `last_instructor` and course-deletion protections.

#### Scenario: An instructor attempts to change their own role

- **WHEN** an instructor sends a valid conditional role update to their own membership URL while another instructor exists
- **THEN** the API returns `403 permission_denied` and leaves the role and version unchanged

#### Scenario: An instructor attempts explicit self-removal

- **WHEN** an instructor sends a valid conditional DELETE to their own explicit membership URL while another instructor exists
- **THEN** the API returns `403 permission_denied` and retains the membership

#### Scenario: An instructor uses the dedicated self-leave operation

- **WHEN** an instructor who is not the last instructor uses `/members/me` to leave
- **THEN** the existing self-leave behavior remains available

### Requirement: Settings do not offer self-administration controls

Course settings SHALL identify the signed-in member by user ID and SHALL omit role-change and Remove controls from that member's roster row, including when the caller is an instructor. An instructor SHALL retain the documented role-change and Remove controls for other members. This view SHALL not add a new instructor Leave course control as part of this change.

#### Scenario: An instructor views their own and another member's rows

- **WHEN** the roster includes the signed-in instructor and another member
- **THEN** the own row has no role selector or Remove button, while the other member's row still has permitted administration controls

### Requirement: Home shows only real course data

The signed-in home page SHALL show a greeting with the member's first name, today's date in the viewer's locale, and the member's real course list with its create and join actions. It SHALL not show placeholder discussion content or a hardcoded date.

#### Scenario: A member opens home

- **WHEN** a signed-in member opens `/home` on Tuesday, March 3
- **THEN** the page shows "Tuesday, March 3" and the member's courses, and no sample discussion panel

### Requirement: Course settings are grouped into sections

The course settings route SHALL group its content into labeled sections:

- **Course details:** the course name form, the course status, and the join code with a copy control whenever the API returns one (only for instructors).
- **Members:** the roster, showing each member's role once, as a control where the viewer may manage that member and as a label otherwise.
- **Danger zone:** for instructors, archive or unarchive and delete actions; for other members, Leave course. It is hidden while the course is being deleted.

The page SHALL not overflow horizontally at phone widths. Existing role-based controls, conditional requests, and self-administration restrictions remain unchanged.

#### Scenario: An instructor opens settings

- **WHEN** an instructor opens course settings
- **THEN** the page shows Course details with a copyable join code, Members with one role control per member, and a Danger zone with the archive and delete actions

#### Scenario: A student opens settings

- **WHEN** a student opens course settings
- **THEN** Course details shows no join code, and the Danger zone offers only Leave course

#### Scenario: A member opens settings on a phone

- **WHEN** a member opens course settings at 390px width
- **THEN** every section fits the screen without horizontal scrolling
