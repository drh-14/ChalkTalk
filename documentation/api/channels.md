## Channels

Message authors, introductory-message authors, and subchannel creators follow the shared [identity visibility policy](identity-visibility.md). Anonymous messages remain supported.

<a id="createChannel"></a>
- **`POST /api/v1/courses/{courseId}/channels`**
  - Description: Creates a channel in a course.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: TA or instructor.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateChannelRequest` (required).
    - `name` (string, required): Human-readable title.
    - `description` (string, required): Human-readable description.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
  - Response body:
    - `data` (object, required): Channel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: active, archived, required): Channel lifecycle state.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request POST '/api/v1/courses/course_123/channels' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"name":"Homework","description":"Discuss weekly assignments"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "channel_123",
        "courseId": "course_123",
        "name": "Homework",
        "description": "Discuss weekly assignments",
        "status": "active",
        "lastActivityAt": "2026-09-01T00:00:00Z",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-01T00:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `422 Unprocessable Content`:
      - `validation_failed`: The channel fields are invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listCourseChannels"></a>
- **`GET /api/v1/courses/{courseId}/channels`**
  - Description: Lists the channels in a course.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `status` (enum: active, archived, optional; values active, archived): Filter by active or archived state.
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
    - `data` (list of objects, required): Channels returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: active, archived, required): Channel lifecycle state.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/channels' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "channel_123",
          "courseId": "course_123",
          "name": "Homework",
          "description": "Discuss weekly assignments",
          "status": "active",
          "lastActivityAt": "2026-09-20T14:30:00Z",
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

<a id="getChannel"></a>
- **`GET /api/v1/channels/{channelId}`**
  - Description: Retrieves a channel.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `channelId` (string, required, 1–255 characters): Identifies the channel resource.
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
    - `data` (object, required): Channel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: active, archived, required): Channel lifecycle state.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request GET '/api/v1/channels/channel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "channel_123",
        "courseId": "course_123",
        "name": "Homework",
        "description": "Discuss weekly assignments",
        "status": "active",
        "lastActivityAt": "2026-09-20T14:30:00Z",
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
      - `not_found`: The channel is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateChannel"></a>
- **`PATCH /api/v1/channels/{channelId}`**
  - Description: Updates a channel’s name, description, or status.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: TA or instructor.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `channelId` (string, required, 1–255 characters): Identifies the channel resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateChannelRequest` (required).
    - `name` (string, optional): Human-readable title.
    - `description` (string, optional): Human-readable description.
    - `status` (enum: active, archived, optional): Replacement channel state.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): `"v4"`, the opaque revision token for the returned fourth revision.
  - Response body:
    - `data` (object, required): Channel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: active, archived, required): Channel lifecycle state.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/channels/channel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"status":"archived"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "channel_123",
        "courseId": "course_123",
        "name": "Homework",
        "description": "Discuss weekly assignments",
        "status": "archived",
        "lastActivityAt": "2026-09-20T14:30:00Z",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
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

<a id="deleteChannel"></a>
- **`DELETE /api/v1/channels/{channelId}`**
  - Description: Deletes a channel. Descendants are deleted or tombstoned where retained conversation structure requires them.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: TA or instructor.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `channelId` (string, required, 1–255 characters): Identifies the channel resource.
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
    curl --request DELETE '/api/v1/channels/channel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
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

<a id="createSubchannel"></a>
- **`POST /api/v1/channels/{channelId}/subchannels`**
  - Description: Creates a subchannel in a channel.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `channelId` (string, required, 1–255 characters): Identifies the channel resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateSubchannelRequest` (required).
    - `title` (string, required): Human-readable title.
    - `introductoryMessage` (CreateContentRequest, required): See the named shape.
      - `introductoryMessage.bodyMarkdown` (string, required): Markdown content.
      - `introductoryMessage.anonymous` (boolean, optional): Whether to hide contributors or author.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
  - Response body:
    - `data` (object, required): Subchannel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.channelId` (string, required): Opaque stable identifier.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, required): Subchannel lifecycle state.
      - `data.createdBy` (object, required): Viewer-aware projection of the subchannel creator.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.introductoryMessage` (object, required): Message details.
  - Example request:

    ```bash
    curl --request POST '/api/v1/channels/channel_123/subchannels' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"title":"Problem set 2","introductoryMessage":{"bodyMarkdown":"Where should we start?","anonymous":false}}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "subchannel_123",
        "channelId": "channel_123",
        "title": "Problem set 2",
        "status": "active",
        "createdBy": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "lastActivityAt": "2026-09-20T14:00:00Z",
        "introductoryMessage": {
          "id": "message_123",
          "subchannelId": "subchannel_123",
          "bodyMarkdown": "Where should we start?",
          "author": {
            "userId": "user_123",
            "displayName": "Ada Lovelace",
            "anonymous": false,
            "deleted": false
          },
          "anonymous": false,
          "deleted": false,
          "createdAt": "2026-09-20T14:00:00Z",
          "updatedAt": "2026-09-20T14:00:00Z",
          "version": 1
        },
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `parent_archived`: The channel or course is archived.
    - `422 Unprocessable Content`:
      - `validation_failed`: The title or introductory message is invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listChannelSubchannels"></a>
- **`GET /api/v1/channels/{channelId}/subchannels`**
  - Description: Lists the subchannels in a channel.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `channelId` (string, required, 1–255 characters): Identifies the channel resource.
  - Query parameters:
    - `status` (enum: active, archived, optional; values active, archived): Filter by active or archived state.
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
    - `data` (list of objects, required): Subchannels returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.channelId` (string, required): Opaque stable identifier.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, required): Subchannel lifecycle state.
      - `data.createdBy` (object, required): Viewer-aware projection of the subchannel creator.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/channels/channel_123/subchannels' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "subchannel_123",
          "channelId": "channel_123",
          "title": "Problem set 2",
          "status": "active",
          "createdBy": {
            "userId": "user_123",
            "displayName": "Ada Lovelace",
            "anonymous": false,
            "deleted": false
          },
          "lastActivityAt": "2026-09-20T14:30:00Z",
          "createdAt": "2026-09-20T14:00:00Z",
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
      - `not_found`: The channel is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getSubchannel"></a>
- **`GET /api/v1/subchannels/{subchannelId}`**
  - Description: Retrieves a subchannel.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `subchannelId` (string, required, 1–255 characters): Identifies the subchannel resource.
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
    - `data` (object, required): Subchannel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.channelId` (string, required): Opaque stable identifier.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, required): Subchannel lifecycle state.
      - `data.createdBy` (object, required): Viewer-aware projection of the subchannel creator.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.introductoryMessage` (object, required): Message details.
  - Example request:

    ```bash
    curl --request GET '/api/v1/subchannels/subchannel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "subchannel_123",
        "channelId": "channel_123",
        "title": "Problem set 2",
        "status": "active",
        "createdBy": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "lastActivityAt": "2026-09-20T14:30:00Z",
        "introductoryMessage": {
          "id": "message_123",
          "subchannelId": "subchannel_123",
          "bodyMarkdown": "Where should we start?",
          "author": {
            "userId": "user_123",
            "displayName": "Ada Lovelace",
            "anonymous": false,
            "deleted": false
          },
          "anonymous": false,
          "deleted": false,
          "createdAt": "2026-09-20T14:00:00Z",
          "updatedAt": "2026-09-20T14:00:00Z",
          "version": 1
        },
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:30:00Z",
        "version": 2
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The subchannel is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateSubchannel"></a>
- **`PATCH /api/v1/subchannels/{subchannelId}`**
  - Description: Updates a subchannel’s title or status.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Creator or staff; only staff may archive.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `subchannelId` (string, required, 1–255 characters): Identifies the subchannel resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateSubchannelRequest` (required).
    - `title` (string, optional): Human-readable title.
    - `status` (enum: active, archived, optional): Replacement subchannel state.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): `"v4"`, the opaque revision token for the returned fourth revision.
  - Response body:
    - `data` (object, required): Subchannel details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.channelId` (string, required): Opaque stable identifier.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: active, archived, required): Subchannel lifecycle state.
      - `data.createdBy` (object, required): Viewer-aware projection of the subchannel creator.
      - `data.lastActivityAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.introductoryMessage` (object, required): Message details.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/subchannels/subchannel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"title":"Problem set 2 help"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "subchannel_123",
        "channelId": "channel_123",
        "title": "Problem set 2 help",
        "status": "active",
        "createdBy": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "lastActivityAt": "2026-09-20T14:30:00Z",
        "introductoryMessage": {
          "id": "message_123",
          "subchannelId": "subchannel_123",
          "bodyMarkdown": "Where should we start?",
          "author": {
            "userId": "user_123",
            "displayName": "Ada Lovelace",
            "anonymous": false,
            "deleted": false
          },
          "anonymous": false,
          "deleted": false,
          "createdAt": "2026-09-20T14:00:00Z",
          "updatedAt": "2026-09-20T14:00:00Z",
          "version": 1
        },
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: The caller cannot change one or more fields.
    - `409 Conflict`:
      - `parent_archived`: The parent channel or course is archived.
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

<a id="deleteSubchannel"></a>
- **`DELETE /api/v1/subchannels/{subchannelId}`**
  - Description: Deletes a subchannel. Messages are deleted or retained as bodyless, authorless tombstones where conversation integrity requires them.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Creator or staff.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `subchannelId` (string, required, 1–255 characters): Identifies the subchannel resource.
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
    curl --request DELETE '/api/v1/subchannels/subchannel_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
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
      - `permission_denied`: The caller cannot delete this subchannel.
    - `409 Conflict`:
      - `parent_archived`: The parent channel or course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="createMessage"></a>
- **`POST /api/v1/subchannels/{subchannelId}/messages`**
  - Description: Creates a message in a subchannel.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `subchannelId` (string, required, 1–255 characters): Identifies the subchannel resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateContentRequest` (required).
    - `bodyMarkdown` (string, required): Markdown content.
    - `anonymous` (boolean, optional): Whether to hide contributors or author.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
  - Response body:
    - `data` (object, required): Message details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.subchannelId` (string, required): Opaque stable identifier.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer.
      - `data.anonymous` (boolean, required): Whether author identity is hidden.
      - `data.deleted` (boolean, required): Whether this is a bodyless tombstone.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request POST '/api/v1/subchannels/subchannel_123/messages' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"bodyMarkdown":"Rayleigh scattering favors shorter wavelengths.","anonymous":false}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "message_123",
        "subchannelId": "subchannel_123",
        "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
        "author": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "anonymous": false,
        "deleted": false,
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `409 Conflict`:
      - `parent_archived`: The subchannel, channel, or course is archived.
    - `422 Unprocessable Content`:
      - `validation_failed`: The message is invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listSubchannelMessages"></a>
- **`GET /api/v1/subchannels/{subchannelId}/messages`**
  - Description: Lists the messages in a subchannel. Messages are ordered oldest first.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `subchannelId` (string, required, 1–255 characters): Identifies the subchannel resource.
  - Query parameters:
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
    - `data` (list of objects, required): Messages returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.subchannelId` (string, required): Opaque stable identifier.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer.
      - `data.anonymous` (boolean, required): Whether author identity is hidden.
      - `data.deleted` (boolean, required): Whether this is a bodyless tombstone.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/subchannels/subchannel_123/messages' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "message_123",
          "subchannelId": "subchannel_123",
          "bodyMarkdown": "Where should we start?",
          "author": {
            "userId": "user_123",
            "displayName": "Ada Lovelace",
            "anonymous": false,
            "deleted": false
          },
          "anonymous": false,
          "deleted": false,
          "createdAt": "2026-09-20T14:00:00Z",
          "updatedAt": "2026-09-20T14:00:00Z",
          "version": 1
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
      - `invalid_request`: Pagination is invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The subchannel is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getMessage"></a>
- **`GET /api/v1/messages/{messageId}`**
  - Description: Retrieves a message.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - `messageId` (string, required, 1–255 characters): Identifies the message resource.
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
    - `data` (object, required): Message details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.subchannelId` (string, required): Opaque stable identifier.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer.
      - `data.anonymous` (boolean, required): Whether author identity is hidden.
      - `data.deleted` (boolean, required): Whether this is a bodyless tombstone.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request GET '/api/v1/messages/message_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "message_123",
        "subchannelId": "subchannel_123",
        "bodyMarkdown": "Where should we start?",
        "author": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "anonymous": false,
        "deleted": false,
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The message is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateMessage"></a>
- **`PATCH /api/v1/messages/{messageId}`**
  - Description: Updates a message.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Author or staff.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `messageId` (string, required, 1–255 characters): Identifies the message resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateMessageRequest` (required).
    - `bodyMarkdown` (string, optional): Markdown content.
    - `anonymous` (boolean, optional): Whether to hide the author.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): `"v4"`, the opaque revision token for the returned fourth revision.
  - Response body:
    - `data` (object, required): Message details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.subchannelId` (string, required): Opaque stable identifier.
      - `data.bodyMarkdown` (string, required): Markdown content.
      - `data.author` (object, required): Author identity visible to the authenticated viewer.
      - `data.anonymous` (boolean, required): Whether author identity is hidden.
      - `data.deleted` (boolean, required): Whether this is a bodyless tombstone.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/messages/message_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"bodyMarkdown":"Start by identifying the recurrence."}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "message_123",
        "subchannelId": "subchannel_123",
        "bodyMarkdown": "Start by identifying the recurrence.",
        "author": {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "anonymous": false,
          "deleted": false
        },
        "anonymous": false,
        "deleted": false,
        "createdAt": "2026-09-20T14:00:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `permission_denied`: The caller cannot edit this message.
    - `409 Conflict`:
      - `parent_archived`: The subchannel, channel, or course is archived.
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

<a id="deleteMessage"></a>
- **`DELETE /api/v1/messages/{messageId}`**
  - Description: Deletes a message. A bodyless, authorless tombstone is retained when required for conversation integrity.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Author or staff.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - `messageId` (string, required, 1–255 characters): Identifies the message resource.
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
    curl --request DELETE '/api/v1/messages/message_123' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
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
      - `permission_denied`: The caller cannot delete this message.
    - `409 Conflict`:
      - `parent_archived`: The subchannel, channel, or course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
