## ADDED Requirements

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
