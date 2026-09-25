## Collaboration Sessions

<a id="createCollaborationSession"></a>

### **`POST /api/v1/courses/{courseId}/collaboration-sessions`**

Creates a temporary collaboration session in a course. Provide exactly one postId or subchannelId. Answer editing uses the answer connection-ticket endpoint and is not a collaboration session. Create a separate one-use connection ticket before opening the collaboration WebSocket.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

None.

#### Request body

##### `CreateCollaborationSessionRequest` (required)

`anchor` (CollaborationAnchor, required): See the named shape.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Collaboration session details.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): The resource to which the collaboration session is attached.

`data.createdBy` (string, required): Opaque stable identifier.

`data.endedAt` (string or null, required): End time; null while active.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/courses/course_123/collaboration-sessions' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"anchor":{"postId":"post_123"}}'
```

#### Example success response

```json
{
  "data": {
    "id": "collab_123",
    "courseId": "course_123",
    "status": "active",
    "anchor": {
      "postId": "post_123"
    },
    "createdBy": "user_123",
    "endedAt": null,
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 1
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `409 Conflict`

`idempotency_key_reused`: The idempotency key was already used with a different request body.

`course_archived`: The course is archived.

##### `422 Unprocessable Content`

`cross_course_anchor`: The anchor is invalid or belongs to another course.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listCourseCollaborationSessions"></a>

### **`GET /api/v1/courses/{courseId}/collaboration-sessions`**

Lists collaboration-session summaries in a course.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`status` (enum: active, ended, optional; values active, ended): Filter by session state.

`anchorType` (enum: post, subchannel, optional; values post, subchannel): Filter by anchor kind.

`anchorId` (string, optional; minimum length 1, maximum length 255): Filter by the attached post or subchannel ID.

`cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.

`limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None specific to this operation.

#### Response body

##### `data` (list of objects, required): Collaboration sessions returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): The resource to which the collaboration session is attached.

`data.createdBy` (string, required): Opaque stable identifier.

`data.endedAt` (string or null, required): End time; null while active.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/collaboration-sessions' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "collab_123",
      "courseId": "course_123",
      "status": "active",
      "anchor": {
        "postId": "post_123"
      },
      "createdBy": "user_123",
      "endedAt": null,
      "createdAt": "2026-09-20T14:30:00Z",
      "updatedAt": "2026-09-20T14:30:00Z",
      "version": 1
    }
  ],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: Filters or pagination are invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCollaborationSession"></a>

### **`GET /api/v1/collaboration-sessions/{collaborationSessionId}`**

Retrieves a collaboration session. Use the connection-ticket endpoint to obtain short-lived WebSocket credentials for an active session.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaborationSession resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token for a later `If-Match` request.

#### Response body

##### `data` (object, required): Collaboration session details.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): The resource to which the collaboration session is attached.

`data.createdBy` (string, required): Opaque stable identifier.

`data.endedAt` (string or null, required): End time; null while active.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request GET '/api/v1/collaboration-sessions/collab_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "collab_123",
    "courseId": "course_123",
    "status": "active",
    "anchor": {
      "postId": "post_123"
    },
    "createdBy": "user_123",
    "endedAt": null,
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 1
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The session is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="endCollaborationSession"></a>

### **`PATCH /api/v1/collaboration-sessions/{collaborationSessionId}`**

Ends a collaboration session. Ended sessions retain their final snapshot.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or staff.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaborationSession resource.

#### Query parameters

None.

#### Request body

##### `EndCollaborationSessionRequest` (required)

`status` (literal ended, required): The only supported transition.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Collaboration session details.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): The resource to which the collaboration session is attached.

`data.createdBy` (string, required): Opaque stable identifier.

`data.endedAt` (string or null, required): End time; null while active.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request PATCH '/api/v1/collaboration-sessions/collab_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"status":"ended"}'
```

#### Example success response

```json
{
  "data": {
    "id": "collab_123",
    "courseId": "course_123",
    "status": "ended",
    "anchor": {
      "postId": "post_123"
    },
    "createdBy": "user_123",
    "endedAt": "2026-09-20T14:40:00Z",
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:40:00Z",
    "version": 4
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: The caller cannot end this session.

##### `409 Conflict`

`session_ended`: The session has already ended.

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`validation_failed`: The status transition is invalid.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createCollaborationConnectionTicket"></a>

### **`POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets`**

Creates a short-lived, one-use ticket for an active temporary collaboration session. The ticket is bound to the authenticated REST session, user, course, collaboration session, document, and effective permission. See [Collaboration WebSocket protocol](collaboration-websocket.md).

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member while the course and collaboration session are active.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaboration session.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Cache-Control` (literal `no-store`): Prevents storage of the ticket response.

#### Response body

##### `data` (object, required): One-use connection credentials.

`data.ticket` (string, required): Opaque secret consumed by the first WebSocket authentication attempt.

`data.webSocketUrl` (string, required): Credential-free WebSocket URL.

`data.documentId` (string, required): Document identifier derived by the server from the collaboration session.

`data.expiresAt` (string, required): UTC expiry timestamp, five minutes after issuance.

#### Example request

```bash
curl --request POST '/api/v1/collaboration-sessions/collab_123/connection-tickets' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```json
{
  "data": {
    "ticket": "opaque_one_use_ticket",
    "webSocketUrl": "wss://api.example.edu/collaboration",
    "documentId": "collab_123",
    "expiresAt": "2026-09-20T14:35:00Z"
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The collaboration session is absent or hidden.

##### `409 Conflict`

`session_ended`: The collaboration session has ended.

`course_archived`: The course is archived.

##### `429 Too Many Requests`

`rate_limited`: Too many ticket requests were made; retry after the duration in `Retry-After`.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCollaborationSessionSnapshot"></a>

### **`GET /api/v1/collaboration-sessions/{collaborationSessionId}/snapshot`**

Retrieves the latest plain-text snapshot of an active or ended collaboration session.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaboration session.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`Cache-Control` (literal `no-store`): Prevents storage of the collaboration snapshot.

#### Response body

##### `data` (object, required): Persisted collaboration text and capture metadata.

`data.collaborationSessionId` (string, required): Opaque stable collaboration-session identifier.

`data.documentId` (string, required): Document identifier derived from the collaboration session.

`data.sessionStatus` (enum: active, ended, required): Session state when captured.

`data.content` (string, required): Plain text from `Y.Text('content').toString()`.

`data.persistedAt` (string, required): UTC timestamp of the returned snapshot.

`data.capturedAt` (string, required): UTC timestamp when the response projection was captured.

#### Example request

```bash
curl --request GET '/api/v1/collaboration-sessions/collab_123/snapshot' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "collaborationSessionId": "collab_123",
    "documentId": "collab_123",
    "sessionStatus": "active",
    "content": "Shared explanation in progress.",
    "persistedAt": "2026-09-20T14:31:58Z",
    "capturedAt": "2026-09-20T14:32:00Z"
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The collaboration session is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.
