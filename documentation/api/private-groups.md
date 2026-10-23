## Course private groups

All routes require a current session. Mutations additionally require an allowed `Origin` and `X-CSRF-Token` header. The course ID and group/member IDs are UUIDs. Unknown resources and nonmembers of the course return `404 not_found`; a current student attempting a mutation receives `403 permission_denied`. All mutation bodies use `application/json` and reject unknown fields with `422 validation_failed`. A deleting or archived course rejects changes with `409 course_archived`.

- `GET /api/v1/courses/{courseId}/private-groups` returns `200 {"data":[{"id","name","joined", "memberIds"?}]}`. Staff see all groups and their current `memberIds`; students see only groups they currently belong to, without the member list. Names sort case-insensitively.
- `POST /api/v1/courses/{courseId}/private-groups` accepts `{"name":"Project mentors","memberIds":["<course-user-id>"]}` and returns `201` with the group in `data` and a `Location` header. `memberIds` may be empty but must be distinct current course members. Names are trimmed, 1–64 characters, and unique case-insensitively per course; duplicates return `409 group_name_exists`.
- `PATCH /api/v1/courses/{courseId}/private-groups/{groupId}` accepts `{"name":"New name"}` and returns `200` with the renamed group. The same name rules apply, including to groups referenced by posts.
- `PUT` and `DELETE /api/v1/courses/{courseId}/private-groups/{groupId}/members/{userId}` respectively add and remove a current course member, each returning `204`. Repeated additions/removals are idempotent. A non-course-member add is rejected, and removal immediately revokes access to every group post and descendant, including one authored by that user.
- `DELETE /api/v1/courses/{courseId}/private-groups/{groupId}` returns `204` when the group is unused; an active referenced post yields `409 group_in_use`. Deleted posts do not keep a group from being removed.

Group management never grants staff read access to the group's posts unless they themselves are current group members. See [Posts](posts.md) for audience creation and access rules.
