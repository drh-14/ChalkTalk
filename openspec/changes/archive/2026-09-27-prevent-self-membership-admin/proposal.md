## Why

Course settings currently offers an instructor role and Remove controls on their own roster row. The instructor-only membership API also permits self-targeted role changes or removal when another instructor remains. That bypasses the intended separate Leave course action and makes accidental self-administration possible.

## What Changes

- Hide role-change and Remove controls on the signed-in instructor's own row in Course settings; retain controls for other members.
- Reject self-targeted instructor `PATCH` and explicit `DELETE /courses/{courseId}/members/{userId}` requests with `403 permission_denied`, after existing authorization and precondition checks.
- Keep `DELETE /courses/{courseId}/members/me` unchanged as the explicit self-leave operation, including final-instructor and deleting-course protection. Do not add an instructor Leave button in this change.
- Update the course membership API reference and OpenAPI examples, and add rendered UI and PostgreSQL-backed HTTP contract tests.

## Non-Goals

- Changing role permissions for administering other members or the last-instructor rule.
- Removing or redesigning the dedicated Leave course endpoint.
- Database schema or migration changes.

## Capabilities

### Modified Capabilities

- `course-management`: prevent self-targeted membership administration while preserving explicit self-leave.

## Impact

- Changes the Course settings roster, membership service, API reference/OpenAPI, and related tests.
- No dependency or database change.
