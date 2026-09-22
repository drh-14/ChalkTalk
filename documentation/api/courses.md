## Courses

<a id="createCourse"></a>
- **`POST /api/v1/organizations/{organizationId}/courses`**
  - Description: Creates a course in an organization. Any authenticated member of the organization may create a course. The creator becomes the course's initial instructor, so `joinCode` is included in the response.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Organization member.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `organizationId` (string, required, 1–255 characters): Identifies the organization resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateCourseRequest` (required).
    - `name` (string, required): Human-readable title.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
    - `ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Course details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.joinCode` (string or null, required): Eight-character join code. Present only for instructors; otherwise null.
  - Example request:

    ```bash
    curl --request POST '/api/v1/organizations/org_123/courses' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"name":"CS 101"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "course_123",
        "organizationId": "org_123",
        "name": "CS 101",
        "status": "active",
        "joinCode": "CS101F26",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-01T00:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `404 Not Found`:
      - `not_found`: The organization is absent or hidden.
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
    - `422 Unprocessable Content`:
      - `validation_failed`: The course name is invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listOrganizationCourses"></a>
- **`GET /api/v1/organizations/{organizationId}/courses`**
  - Description: Lists the courses in an organization.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Organization member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `organizationId` (string, required, 1–255 characters): Identifies the organization resource.
  - Query parameters:
    - `status` (enum: active, archived, deleting, optional; values active, archived, deleting): Filter by course state.
    - `cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.
    - `limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - `data` (list of objects, required): Courses returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/organizations/org_123/courses' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "course_123",
          "organizationId": "org_123",
          "name": "CS 101",
          "status": "active",
          "createdAt": "2026-09-01T00:00:00Z",
          "updatedAt": "2026-09-20T14:30:00Z",
          "version": 3
        }
      ],
      "page": {
        "nextCursor": null,
        "hasMore": false
      }
    }
    ```
  - Errors:
    - `400 Bad Request`:
      - `invalid_request`: Filters or pagination are invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The organization is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listCourses"></a>
- **`GET /api/v1/courses`**
  - Description: Lists the courses that contain the authenticated user.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Signed-in user.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - None.
  - Query parameters:
    - `status` (enum: active, archived, deleting, optional; values active, archived, deleting): Filter by course state.
    - `cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.
    - `limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - `data` (list of objects, required): Courses returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "course_123",
          "organizationId": "org_123",
          "name": "CS 101",
          "status": "active",
          "createdAt": "2026-09-01T00:00:00Z",
          "updatedAt": "2026-09-20T14:30:00Z",
          "version": 3
        }
      ],
      "page": {
        "nextCursor": null,
        "hasMore": false
      }
    }
    ```
  - Errors:
    - `400 Bad Request`:
      - `invalid_request`: Filters or pagination are invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getCourse"></a>
- **`GET /api/v1/courses/{courseId}`**
  - Description: Retrieves a course. joinCode is non-null only for instructors. A deleting course remains retrievable until background deletion finishes, after which this operation returns not_found.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token for a later `If-Match` request.
  - Response body:
    - `data` (object, required): Course details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.joinCode` (string or null, required): Eight-character join code. Present only for instructors; otherwise null.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "course_123",
        "organizationId": "org_123",
        "name": "CS 101",
        "status": "active",
        "joinCode": "CS101F26",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-20T14:30:00Z",
        "version": 3
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateCourse"></a>
- **`PATCH /api/v1/courses/{courseId}`**
  - Description: Updates a course’s name or status. At least one field is required.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Instructor.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateCourseRequest` (required).
    - `name` (string, optional): Human-readable title.
    - `status` (enum: active, archived, optional): Replacement course state.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Course details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.joinCode` (string or null, required): Eight-character join code. Present only for instructors; otherwise null.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/courses/course_123' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"status":"archived"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "course_123",
        "organizationId": "org_123",
        "name": "CS 101",
        "status": "archived",
        "joinCode": "CS101F26",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `course_deleting`: The course is being deleted.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `422 Unprocessable Content`:
      - `validation_failed`: No valid editable field was supplied.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteCourse"></a>
- **`DELETE /api/v1/courses/{courseId}`**
  - Description: Deletes a course. Returns a course with status deleting. Location identifies the same course for polling; it eventually returns not_found after posts, collaboration data, search records, and stored files are removed.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Instructor.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `202 Accepted`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
  - Response body:
    - `data` (object, required): Course details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.organizationId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, deleting, required): Course lifecycle state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.joinCode` (string or null, required): Eight-character join code. Present only for instructors; otherwise null.
  - Example request:

    ```bash
    curl --request DELETE '/api/v1/courses/course_123' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'If-Match: "v3"'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "course_123",
        "organizationId": "org_123",
        "name": "CS 101",
        "status": "deleting",
        "joinCode": "CS101F26",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `course_deleting`: Deletion is already in progress.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
