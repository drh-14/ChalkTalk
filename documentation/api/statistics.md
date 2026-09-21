## Statistics

<a id="getCourseStatistics"></a>
- **`GET /api/v1/courses/{courseId}/statistics`**
  - Description: Retrieves aggregate statistics for a course.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Instructor or TA.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `period` (enum: 7d, 30d, course_to_date, optional; default 30d, values 7d, 30d, course_to_date): Aggregation period.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - `data` (object, required): Aggregate course activity statistics.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.period` (enum: 7d, 30d, course_to_date, required): Aggregation period.
      - `data.postsCreated` (integer, required): Posts created during the period.
      - `data.questionsAnswered` (integer, required): Questions answered during the period.
      - `data.activeStudents` (integer, required): Distinct participating students.
      - `data.pollVotes` (integer, required): Votes cast during the period.
      - `data.generatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/statistics' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "courseId": "course_123",
        "period": "30d",
        "postsCreated": 42,
        "questionsAnswered": 31,
        "activeStudents": 84,
        "pollVotes": 120,
        "generatedAt": "2026-09-20T14:30:00Z"
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: A staff role is required.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listStudentStatistics"></a>
- **`GET /api/v1/courses/{courseId}/statistics/students`**
  - Description: Lists per-student statistics for a course.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Instructor or TA.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `period` (enum: 7d, 30d, course_to_date, optional; default 30d, values 7d, 30d, course_to_date): Aggregation period.
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
    - `data` (list of objects, required): Per-student activity statistics returned by this request.
      - `data.user` (object, required): User identity and profile summary.
      - `data.postsCreated` (integer, required): Posts created by the student.
      - `data.answersContributed` (integer, required): Shared answers edited by the student.
      - `data.messagesCreated` (integer, required): Messages created by the student.
      - `data.engagementScore` (number, required): Course-defined engagement score.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/statistics/students' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "user": {
            "id": "user_123",
            "displayName": "Ada Lovelace"
          },
          "postsCreated": 4,
          "answersContributed": 3,
          "messagesCreated": 12,
          "engagementScore": 19.5
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
      - `invalid_request`: The period or pagination is invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: A staff role is required.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
