## Course Memberships

<a id="joinCourse"></a>
- **`POST /api/v1/courses/{courseId}/members`**
  - Description: Adds the authenticated user to a course. Join links and QR codes contain both courseId and joinCode. New members always enter as students.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Signed-in user.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `JoinCourseRequest` (required).
    - `joinCode` (string, required): Eight uppercase letters or digits from the join link or QR code.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
    - `ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Course membership details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.user` (object, required): User identity and profile summary.
      - `data.role` (enum: student, ta, instructor, required): Role held in the course.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request POST '/api/v1/courses/course_123/members' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"joinCode":"CS101F26"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "membership_123",
        "courseId": "course_123",
        "user": {
          "id": "user_123",
          "displayName": "Ada Lovelace"
        },
        "role": "student",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-01T00:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
      - `already_member`: The user is already a member.
      - `course_archived`: The course does not accept joins.
    - `422 Unprocessable Content`:
      - `invalid_join_code`: The eight-character join code is invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listCourseMembers"></a>
- **`GET /api/v1/courses/{courseId}/members`**
  - Description: Lists the members of a course.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `role` (enum: student, ta, instructor, optional; values student, ta, instructor): Filter by course role.
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
    - `data` (list of objects, required): Course memberships returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.user` (object, required): User identity and profile summary.
      - `data.role` (enum: student, ta, instructor, required): Role held in the course.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/members' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "membership_123",
          "courseId": "course_123",
          "user": {
            "id": "user_123",
            "displayName": "Ada Lovelace"
          },
          "role": "student",
          "createdAt": "2026-09-01T00:00:00Z",
          "updatedAt": "2026-09-20T14:30:00Z",
          "version": 2
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
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getCourseMember"></a>
- **`GET /api/v1/courses/{courseId}/members/{userId}`**
  - Description: Retrieves a course member. The ETag protects later role changes or removal.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
    - `userId` (string, required, 1–255 characters): Identifies the user resource.
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
    - `data` (object, required): Course membership details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.user` (object, required): User identity and profile summary.
      - `data.role` (enum: student, ta, instructor, required): Role held in the course.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/members/user_123' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "membership_123",
        "courseId": "course_123",
        "user": {
          "id": "user_123",
          "displayName": "Ada Lovelace"
        },
        "role": "student",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-20T14:30:00Z",
        "version": 2
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The membership is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateCourseMember"></a>
- **`PATCH /api/v1/courses/{courseId}/members/{userId}`**
  - Description: Updates a course member’s role.
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
    - `userId` (string, required, 1–255 characters): Identifies the user resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateMembershipRequest` (required).
    - `role` (enum: student, ta, instructor, required): Replacement course role.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Course membership details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.user` (object, required): User identity and profile summary.
      - `data.role` (enum: student, ta, instructor, required): Role held in the course.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/courses/course_123/members/user_123' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"role":"ta"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "membership_123",
        "courseId": "course_123",
        "user": {
          "id": "user_123",
          "displayName": "Ada Lovelace"
        },
        "role": "ta",
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
    - `404 Not Found`:
      - `not_found`: The membership is absent or hidden.
    - `409 Conflict`:
      - `last_instructor`: The update would demote the final instructor.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `422 Unprocessable Content`:
      - `validation_failed`: The role is invalid.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteCourseMember"></a>
- **`DELETE /api/v1/courses/{courseId}/members/{userId}`**
  - Description: Removes a member from a course.
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
    - `userId` (string, required, 1–255 characters): Identifies the user resource.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request DELETE '/api/v1/courses/course_123/members/user_123' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'If-Match: "v3"'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The membership is absent or hidden.
    - `409 Conflict`:
      - `last_instructor`: The final instructor cannot be removed.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="leaveCourse"></a>
- **`DELETE /api/v1/courses/{courseId}/members/me`**
  - Description: Removes the authenticated user from a course.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request DELETE '/api/v1/courses/course_123/members/me' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `409 Conflict`:
      - `last_instructor`: The final instructor cannot leave.
      - `course_deleting`: Course deletion is in progress.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
