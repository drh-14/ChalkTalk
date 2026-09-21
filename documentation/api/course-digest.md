## Course Digest

Post authors in digest entries follow the shared [identity visibility policy](identity-visibility.md); derived data never exposes a hidden identity.

<a id="getCourseDigest"></a>
- **`GET /api/v1/courses/{courseId}/digest`**
  - Description: Retrieves the digest for a course. The digest combines automatically ranked entries with manual inclusions.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
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
    - `data` (object, required): Course digest details.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.generatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.entries` (list of objects, required): Ranked digest entries.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/digest' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "courseId": "course_123",
        "generatedAt": "2026-09-20T14:30:00Z",
        "entries": []
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

<a id="putCourseDigestEntry"></a>
- **`PUT /api/v1/courses/{courseId}/digest/entries/{postId}`**
  - Description: Manually includes a post in a course digest. Idempotently marks the post as manually included. The returned digest carries the latest ETag.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Instructor or TA.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
    - `postId` (string, required, 1–255 characters): Identifies the post resource.
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
    - `data` (object, required): Course digest details.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.generatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.entries` (list of objects, required): Ranked digest entries.
  - Example request:

    ```bash
    curl --request PUT '/api/v1/courses/course_123/digest/entries/post_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "courseId": "course_123",
        "generatedAt": "2026-09-20T14:30:00Z",
        "entries": [
          {
            "post": {
              "id": "post_123",
              "courseId": "course_123",
              "type": "question",
              "title": "Why is the sky blue?",
              "bodyMarkdown": "How does scattering work?",
              "author": {
                "userId": "user_123",
                "displayName": "Ada Lovelace",
                "anonymous": false,
                "deleted": false
              },
              "anonymous": false,
              "tags": [
                "physics"
              ],
              "attachments": [],
              "pinned": false,
              "duplicateOfPostId": null,
              "duplicateStatus": "none",
              "answered": true,
              "lastActivityAt": "2026-09-20T14:30:00Z",
              "createdAt": "2026-09-20T13:00:00Z",
              "updatedAt": "2026-09-20T14:30:00Z",
              "version": 3
            },
            "source": "manual",
            "manuallyIncluded": true,
            "includedAt": "2026-09-20T14:30:00Z",
            "engagementScore": 0
          }
        ]
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: A staff role is required.
    - `404 Not Found`:
      - `not_found`: The course or post is absent or hidden.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteCourseDigestEntry"></a>
- **`DELETE /api/v1/courses/{courseId}/digest/entries/{postId}`**
  - Description: Removes a post’s manual inclusion in a course digest. Returns 204 whether or not the post is currently manually included. Automatic ranking may still include the post.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Instructor or TA.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
    - `postId` (string, required, 1–255 characters): Identifies the post resource.
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
    curl --request DELETE '/api/v1/courses/course_123/digest/entries/post_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: A staff role is required.
    - `404 Not Found`:
      - `not_found`: The course or post is absent or hidden.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
