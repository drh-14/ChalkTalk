## Course information and staff

These routes back the Course information and Staff tabs. All require the `__Host-chalktalk_session` cookie, and missing authentication returns `401 authentication_required`. Reads are for current members of active or archived courses; anyone else receives `404 not_found`. Writes are for current instructors of active courses and require an allowed `Origin` and `X-CSRF-Token`. Other users receive `403 permission_denied`, and archived courses return `409 course_archived`. Writes need `If-Match` with the current ETag: a missing header returns `428 precondition_required`, and a stale one returns `412 version_conflict`. Invalid fields return `422 validation_failed`. Responses use `Cache-Control: private, no-store`.

<a id="getCourseInformation"></a>

### `GET /api/v1/courses/{courseId}/information`

Returns `200` with an `ETag` and `{ data: { courseId, descriptionMarkdown, website, syllabus, version } }`. `syllabus` is null or the [public file metadata](resources.md#implemented-course-files). A course nobody has edited reads as an empty description at version 1.

<a id="updateCourseInformation"></a>

### `PATCH /api/v1/courses/{courseId}/information`

Requires both `descriptionMarkdown` (at most 50,000 characters) and `website` (null, or an absolute HTTP(S) URL of at most 2048 characters without credentials). Returns `200` with the updated information and its `ETag`.

<a id="replaceCourseSyllabus"></a>

### `PUT /api/v1/courses/{courseId}/information/syllabus`

Accepts a multipart `file` with the limits of [standalone uploads](resources.md#post-apiv1coursescourseidfiles). Returns `200` with the updated information. The previous syllabus file is retired and its bytes are queued for cleanup. Syllabus files are not part of the resource catalog, so they are not text-searched.

<a id="removeCourseSyllabus"></a>

### `DELETE /api/v1/courses/{courseId}/information/syllabus`

Removes the syllabus and returns `200` with the updated information.

<a id="listCourseStaff"></a>

### `GET /api/v1/courses/{courseId}/staff`

Returns `200` with `{ data: [{ userId, displayName, role, contact, location, officeHours, version }] }` for current TAs and instructors, instructors first and then by display name.

<a id="updateCourseStaffProfile"></a>

### `PATCH /api/v1/courses/{courseId}/staff/{userId}`

Requires `contact`, `location` and `officeHours`, each at most 2000 characters, with the profile's `If-Match`. Returns `200` with the updated profile and its `ETag`. A target who is not current course staff returns `404 not_found`.
