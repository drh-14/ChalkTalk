## Posts

Author fields and anonymous-content filtering follow the shared [identity visibility policy](identity-visibility.md).

<a id="createPost"></a>
- **`POST /api/v1/courses/{courseId}/posts`**
  - Description: Creates a post in a course.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member; creating a poll requires TA or instructor.
  - Request media: `application/json`, `multipart/form-data`
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
    - Schema: `CreatePostRequest` (required).
    - Shape: exactly one of CreateQuestionPostRequest, CreateNotePostRequest, CreatePollPostRequest.
    - `CreateQuestionPostRequest` fields:
      - `type` (literal question, required): See the named shape.
      - `title` (string, required): Human-readable title.
      - `bodyMarkdown` (string, required): Markdown content.
      - `anonymous` (boolean, optional): Hide the author from course members.
      - `tags` (list of string, optional): Post tags.
    - `CreateNotePostRequest` fields:
      - `type` (literal note, required): See the named shape.
      - `title` (string, required): Human-readable title.
      - `bodyMarkdown` (string, required): Markdown content.
      - `anonymous` (boolean, optional): Hide the author from course members.
      - `tags` (list of string, optional): Post tags.
    - `CreatePollPostRequest` fields:
      - `type` (literal poll, required): See the named shape.
      - `title` (string, required): Human-readable title.
      - `bodyMarkdown` (string, required): Markdown content.
      - `anonymous` (boolean, optional): Hide the author from course members.
      - `tags` (list of string, optional): Post tags.
      - `options` (list of PollOptionInput, required): Poll choices.
  - Multipart parts:
    - `metadata` (`CreatePostRequest`, required, `application/json`): Send metadata as application/json and repeat the attachments part up to five times. Each file may be at most 25 MiB and must be PDF, plain text, Markdown, PNG, JPEG, or WebP.
    - Shape: exactly one of CreateQuestionPostRequest, CreateNotePostRequest, CreatePollPostRequest.
    - `CreateQuestionPostRequest` fields:
      - `metadata.type` (literal question, required): See the named shape.
      - `metadata.title` (string, required): Human-readable title.
      - `metadata.bodyMarkdown` (string, required): Markdown content.
      - `metadata.anonymous` (boolean, optional): Hide the author from course members.
      - `metadata.tags` (list of string, optional): Post tags.
    - `CreateNotePostRequest` fields:
      - `metadata.type` (literal note, required): See the named shape.
      - `metadata.title` (string, required): Human-readable title.
      - `metadata.bodyMarkdown` (string, required): Markdown content.
      - `metadata.anonymous` (boolean, optional): Hide the author from course members.
      - `metadata.tags` (list of string, optional): Post tags.
    - `CreatePollPostRequest` fields:
      - `metadata.type` (literal poll, required): See the named shape.
      - `metadata.title` (string, required): Human-readable title.
      - `metadata.bodyMarkdown` (string, required): Markdown content.
      - `metadata.anonymous` (boolean, optional): Hide the author from course members.
      - `metadata.tags` (list of string, optional): Post tags.
      - `metadata.options` (list of PollOptionInput, required): Poll choices.
    - `attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
    - `ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Post details.
      - `data.id` (string, required): Opaque stable post identifier.
      - `data.courseId` (string, required): Opaque identifier of the course containing the post.
      - `data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.
      - `data.title` (string, required): Human-readable title.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.
      - `data.anonymous` (boolean, required): Whether the post was authored anonymously.
      - `data.tags` (list of strings, required): Course-defined post tags.
      - `data.attachments` (list of objects, required): Files attached to the post.
      - `data.pinned` (boolean, required): Whether staff pinned the post.
      - `data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.
      - `data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.
      - `data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.
      - `data.options` (list of objects, required when `type` is `poll`): Poll choices.
        - `data.options[].id` (string, required): Opaque stable poll-option identifier.
        - `data.options[].label` (string, required): Visible choice label.
        - `data.options[].voteCount` (integer, required): Votes currently cast for the option.
        - `data.options[].selected` (boolean, required): Whether the authenticated user selected the option.
      - `data.totalVotes` (integer, required when `type` is `poll`): Total votes cast in the poll.
  - Example request:

    ```bash
    curl --request POST '/api/v1/courses/course_123/posts' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"type":"question","title":"Why is the sky blue?","bodyMarkdown":"How does scattering work?","anonymous":false,"tags":["physics"]}'
    ```

  - Example success response:

    ```json
    {
      "data": {
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
        "answered": false,
        "lastActivityAt": "2026-09-20T13:00:00Z",
        "createdAt": "2026-09-20T13:00:00Z",
        "updatedAt": "2026-09-20T13:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: Only staff may create polls.
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
      - `course_archived`: The course is archived.
    - `413 Content Too Large`:
      - `payload_too_large`: An attachment exceeds 25 MiB or the five-file limit.
    - `415 Unsupported Media Type`:
      - `unsupported_media_type`: An attachment type is unsupported.
    - `422 Unprocessable Content`:
      - `validation_failed`: The post fields are invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listCoursePosts"></a>
- **`GET /api/v1/courses/{courseId}/posts`**
  - Description: Lists or searches the posts in a course. Without q, results default to recent_activity. With q, results default to relevance. relevance is invalid when q is omitted.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `q` (string, optional; minimum length 1, maximum length 500): Trimmed non-empty search text. Omit to list without full-text search.
    - `type` (enum: question, note, poll, optional; values question, note, poll): Filter by post type.
    - `tag` (list of string, optional): Filter by one or more tags; repeated query parameters use OR semantics.
    - `authorId` (string, optional; minimum length 1, maximum length 255): Filter by author identifier. Staff may match all content; students may match nonanonymous content and their own anonymous content. Items whose identity is hidden from the viewer are removed before ranking, pagination, `hasMore`, and counts; no visible matches return an empty `200 OK` collection.
    - `createdAfter` (string, optional): Return posts created at or after this timestamp.
    - `createdBefore` (string, optional): Return posts created at or before this timestamp.
    - `answered` (boolean, optional): Filter question posts by answer presence.
    - `duplicateStatus` (enum: none, suggested, confirmed, optional; values none, suggested, confirmed): Filter by duplicate-review state.
    - `sort` (enum: relevance, newest, recent_activity, optional; values relevance, newest, recent_activity): Ordering. Defaults to relevance when q is present and recent_activity otherwise.
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
    - `data` (list of objects, required): Every returned post contains the fields below.
      - `data[].id` (string, required): Opaque stable post identifier.
      - `data[].courseId` (string, required): Opaque identifier of the course containing the post.
      - `data[].type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.
      - `data[].title` (string, required): Human-readable title.
      - `data[].bodyMarkdown` (string, required): Markdown content.
      - `data[].author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.
      - `data[].anonymous` (boolean, required): Whether the post was authored anonymously.
      - `data[].tags` (list of strings, required): Course-defined post tags.
      - `data[].attachments` (list of objects, required): Files attached to the post.
      - `data[].pinned` (boolean, required): Whether staff pinned the post.
      - `data[].duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.
      - `data[].duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.
      - `data[].lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.
      - `data[].createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.
      - `data[].updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.
      - `data[].version` (integer, required): Revision number used to construct the resource ETag.
      - `data[].answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.
      - `data[].options` (list of objects, required when `type` is `poll`): Poll choices.
        - `data[].options[].id` (string, required): Opaque stable poll-option identifier.
        - `data[].options[].label` (string, required): Visible choice label.
        - `data[].options[].voteCount` (integer, required): Votes currently cast for the option.
        - `data[].options[].selected` (boolean, required): Whether the authenticated user selected the option.
      - `data[].totalVotes` (integer, required when `type` is `poll`): Total votes cast in the poll.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/posts' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
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
      - `invalid_request`: The query, filters, date range, sort, or pagination are invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getPost"></a>
- **`GET /api/v1/posts/{postId}`**
  - Description: Retrieves a post.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
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
    - `data` (object, required): Post details.
      - `data.id` (string, required): Opaque stable post identifier.
      - `data.courseId` (string, required): Opaque identifier of the course containing the post.
      - `data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.
      - `data.title` (string, required): Human-readable title.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.
      - `data.anonymous` (boolean, required): Whether the post was authored anonymously.
      - `data.tags` (list of strings, required): Course-defined post tags.
      - `data.attachments` (list of objects, required): Files attached to the post.
      - `data.pinned` (boolean, required): Whether staff pinned the post.
      - `data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.
      - `data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.
      - `data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.
      - `data.options` (list of objects, required when `type` is `poll`): Poll choices.
        - `data.options[].id` (string, required): Opaque stable poll-option identifier.
        - `data.options[].label` (string, required): Visible choice label.
        - `data.options[].voteCount` (integer, required): Votes currently cast for the option.
        - `data.options[].selected` (boolean, required): Whether the authenticated user selected the option.
      - `data.totalVotes` (integer, required when `type` is `poll`): Total votes cast in the poll.
  - Example request:

    ```bash
    curl --request GET '/api/v1/posts/post_123' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": {
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
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The post is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updatePost"></a>
- **`PATCH /api/v1/posts/{postId}`**
  - Description: Updates a post. Members may suggest duplicates. Staff may confirm duplicates and change pinned. At least one metadata field or attachment addition is required.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Author or staff, subject to field permissions.
  - Request media: `application/json`, `multipart/form-data`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `postId` (string, required, 1–255 characters): Identifies the post resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdatePostRequest` (required).
    - `title` (string, optional): Human-readable title.
    - `bodyMarkdown` (string, optional): Markdown content.
    - `anonymous` (boolean, optional): Whether to hide the author.
    - `tags` (list of string, optional): Replacement tags.
    - `pinned` (boolean, optional): Staff-controlled pinned state.
    - `duplicateOfPostId` (string or null, optional): Original post ID, or null to clear the relationship.
    - `duplicateStatus` (enum: none, suggested, confirmed, optional): Duplicate-review state.
    - `removeAttachmentIds` (list of string, optional): Existing attachments to remove.
  - Multipart parts:
    - `metadata` (`UpdatePostRequest`, required, `application/json`): Send metadata as application/json. Existing attachments remain unless metadata.removeAttachmentIds contains their IDs; repeated attachments parts add up to the five-file limit.
    - `metadata.title` (string, optional): Human-readable title.
    - `metadata.bodyMarkdown` (string, optional): Markdown content.
    - `metadata.anonymous` (boolean, optional): Whether to hide the author.
    - `metadata.tags` (list of string, optional): Replacement tags.
    - `metadata.pinned` (boolean, optional): Staff-controlled pinned state.
    - `metadata.duplicateOfPostId` (string or null, optional): Original post ID, or null to clear the relationship.
    - `metadata.duplicateStatus` (enum: none, suggested, confirmed, optional): Duplicate-review state.
    - `metadata.removeAttachmentIds` (list of string, optional): Existing attachments to remove.
    - `attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Post details.
      - `data.id` (string, required): Opaque stable post identifier.
      - `data.courseId` (string, required): Opaque identifier of the course containing the post.
      - `data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.
      - `data.title` (string, required): Human-readable title.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.
      - `data.anonymous` (boolean, required): Whether the post was authored anonymously.
      - `data.tags` (list of strings, required): Course-defined post tags.
      - `data.attachments` (list of objects, required): Files attached to the post.
      - `data.pinned` (boolean, required): Whether staff pinned the post.
      - `data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.
      - `data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.
      - `data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.
      - `data.options` (list of objects, required when `type` is `poll`): Poll choices.
        - `data.options[].id` (string, required): Opaque stable poll-option identifier.
        - `data.options[].label` (string, required): Visible choice label.
        - `data.options[].voteCount` (integer, required): Votes currently cast for the option.
        - `data.options[].selected` (boolean, required): Whether the authenticated user selected the option.
      - `data.totalVotes` (integer, required when `type` is `poll`): Total votes cast in the poll.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/posts/post_123' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"title":"Why does the daytime sky look blue?","removeAttachmentIds":["attachment_old"]}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "post_123",
        "courseId": "course_123",
        "type": "question",
        "title": "Why does the daytime sky look blue?",
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
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: The caller cannot change one or more fields.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `413 Content Too Large`:
      - `payload_too_large`: An attachment exceeds a limit.
    - `415 Unsupported Media Type`:
      - `unsupported_media_type`: An attachment type is unsupported.
    - `422 Unprocessable Content`:
      - `validation_failed`: No valid editable field was supplied.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deletePost"></a>
- **`DELETE /api/v1/posts/{postId}`**
  - Description: Deletes a post. A bodyless, authorless tombstone is retained when nested content requires it.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Author or staff.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
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
    curl --request DELETE '/api/v1/posts/post_123' \
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
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: Deletion is forbidden.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="putPostVote"></a>
- **`PUT /api/v1/posts/{postId}/vote`**
  - Description: Casts or changes the authenticated user’s vote on a poll. Each user has one selected option; another PUT changes the vote.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `postId` (string, required, 1–255 characters): Identifies the post resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `VoteRequest` (required).
    - `optionId` (string, required): Opaque stable identifier.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - `data` (object, required): The caller's vote and the updated poll totals.
      - `data.postId` (string, required): Opaque stable identifier.
      - `data.options` (list of objects, required): Updated poll choices.
      - `data.totalVotes` (integer, required): Total votes cast.
  - Example request:

    ```bash
    curl --request PUT '/api/v1/posts/post_123/vote' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'Content-Type: application/json' \
        --data '{"optionId":"option_1"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "postId": "post_123",
        "options": [
          {
            "id": "option_1",
            "label": "Blue",
            "voteCount": 12,
            "selected": true
          },
          {
            "id": "option_2",
            "label": "Red",
            "voteCount": 4,
            "selected": false
          }
        ],
        "totalVotes": 16
      }
    }
    ```
  - Errors:
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `poll_closed`: The poll or course is closed.
    - `422 Unprocessable Content`:
      - `not_a_poll`: The post is not a poll.
      - `poll_option_invalid`: The option does not belong to this poll.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deletePostVote"></a>
- **`DELETE /api/v1/posts/{postId}/vote`**
  - Description: Retracts the authenticated user’s vote from a poll. Returns 204 even when the caller has no vote.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
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
    curl --request DELETE '/api/v1/posts/post_123/vote' \
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
    - `409 Conflict`:
      - `poll_closed`: The poll or course is closed.
    - `422 Unprocessable Content`:
      - `not_a_poll`: The post is not a poll.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
