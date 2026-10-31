## Collaboration Sessions

Live sessions are private, temporary shared code and whiteboard documents anchored to a post. A session nobody has been connected to for `COLLABORATION_IDLE_END_MINUTES` (default 120) ends automatically. A session is visible only to its creator, current course TAs and instructors, and current course members invited to it; anyone else receives `404 not_found`, exactly as for an absent session. A session on a [private post](posts.md) is also hidden from, and cannot be joined by, any member who cannot read that post. Editing happens over the [collaboration WebSocket](collaboration-websocket.md) after obtaining a one-use connection ticket. Thread conversations are not valid session anchors.

<a id="createCollaborationSession"></a>

### **`POST /api/v1/courses/{courseId}/collaboration-sessions`**

Creates an active, private live session anchored to a readable post in an active course. The creator becomes the first participant. The text starts empty. Create a separate one-use connection ticket before opening the collaboration WebSocket.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current member of an active course who can read the anchor post.

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

`anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`title` (string, optional, 1–120 characters): Optional title, 1 to 120 characters after trimming; defaults to the post title.

`language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, optional): Syntax-highlighting language. The editor never runs code.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource.

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): The collaboration session was created.

`data.id` (string, required, 1–255 characters): Opaque stable identifier.

`data.courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data.anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

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
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Content-Type: application/json' \
    --data '{"anchor":{"postId":"post_123"},"language":"python"}'
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
    "title": "Why does my loop never stop?",
    "language": "python",
    "createdBy": "user_123",
    "participants": [
      {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "role": "creator",
        "permission": "edit"
      }
    ],
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

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `409 Conflict`

`course_archived`: The course is archived.

`idempotency_key_reused`: The idempotency key was already used with a different request body.

##### `422 Unprocessable Content`

`cross_course_anchor`: The anchor is invalid, belongs to another course, or is a private post the caller cannot read.

`validation_failed`: The request body is invalid.

##### `429 Too Many Requests`

`rate_limited`: Too many sessions created in the last hour, per `RATE_LIMIT_COLLABORATION_CREATE_USER` (default 30). Idempotent replays are not counted. The response includes `Retry-After`.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listCourseCollaborationSessions"></a>

### **`GET /api/v1/courses/{courseId}/collaboration-sessions`**

Lists the course's collaboration sessions visible to the caller, newest first. Hidden sessions are excluded before pagination and hasMore are calculated. Visible only to the session creator, current course TAs and instructors, and current course members invited to the session; anyone else receives 404 not_found.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member. Results include only sessions the caller created, was invited to, or can open as current course staff.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`status` (enum: active, ended, optional): Filter by session state.

`anchorType` (enum: post, optional): Filter by anchor kind. Only post anchors exist.

`anchorId` (string, optional; minimum length 1, maximum length 255): Filter by the anchored post ID.

`cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.

`limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None.

#### Response body

##### `data` (list of objects, required): Collection of CollaborationSessionSummary records.

`data[].id` (string, required, 1–255 characters): Opaque stable identifier.

`data[].courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].status` (enum: active, ended, required): Session lifecycle state.

`data[].anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data[].anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data[].language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data[].createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants` (list of objects, required): The creator and invited participants.

`data[].participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants[].displayName` (string, required): Account display name.

`data[].participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data[].participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

`data[].endedAt` (string or null, required): End time; null while active.

`data[].createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].version` (integer, required): Revision number used to construct the resource ETag.

##### `page` (object, required): Cursor pagination state.

`page.nextCursor` (string or null, required): Opaque cursor for the next page.

`page.hasMore` (boolean, required): Whether another page exists.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/collaboration-sessions?status=active&anchorType=post&anchorId=post_123' \
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
      "title": "Why does my loop never stop?",
      "language": "python",
      "createdBy": "user_123",
      "participants": [
        {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "role": "creator",
          "permission": "edit"
        },
        {
          "userId": "user_456",
          "displayName": "Grace Hopper",
          "role": "invitee",
          "permission": "edit"
        }
      ],
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

`invalid_request`: The query parameters or cursor are invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="listMyCollaborationSessions"></a>

### **`GET /api/v1/users/me/collaboration-sessions`**

Lists the sessions the caller created or was invited to, newest first, across courses that are active and of which the caller is still a member. Sessions whose post is deleted or a confirmed duplicate are excluded before pagination and hasMore are calculated. Staff see only their own sessions here; the [course list](#listCourseCollaborationSessions) shows every session in a course.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Any signed-in user. Results include only the caller's own sessions.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

None.

#### Query parameters

`status` (enum: active, ended, optional): Filter by session state.

`cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.

`limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None.

#### Response body

##### `data` (list of objects, required): Collection of MyCollaborationSession records.

`data[].courseName` (string, required): Name of the session's course.

`data[].id` (string, required, 1–255 characters): Opaque stable identifier.

`data[].courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].status` (enum: active, ended, required): Session lifecycle state.

`data[].anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data[].anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data[].language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data[].createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants` (list of objects, required): The creator and invited participants.

`data[].participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants[].displayName` (string, required): Account display name.

`data[].participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data[].participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

`data[].endedAt` (string or null, required): End time; null while active.

`data[].createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].version` (integer, required): Revision number used to construct the resource ETag.

##### `page` (object, required): Cursor pagination state.

`page.nextCursor` (string or null, required): Opaque cursor for the next page.

`page.hasMore` (boolean, required): Whether another page exists.

#### Example request

```bash
curl --request GET '/api/v1/users/me/collaboration-sessions?status=active' \
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
      "courseName": "CS 101",
      "status": "active",
      "anchor": {
        "postId": "post_123"
      },
      "title": "Why does my loop never stop?",
      "language": "python",
      "createdBy": "user_123",
      "participants": [
        {
          "userId": "user_123",
          "displayName": "Ada Lovelace",
          "role": "creator",
          "permission": "edit"
        },
        {
          "userId": "user_456",
          "displayName": "Grace Hopper",
          "role": "invitee",
          "permission": "edit"
        }
      ],
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

`invalid_request`: The query parameters or cursor are invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="getCollaborationSession"></a>

### **`GET /api/v1/collaboration-sessions/{collaborationSessionId}`**

Retrieves a collaboration session. Use the connection-ticket endpoint to obtain short-lived WebSocket credentials for an active session. Visible only to the session creator, current course TAs and instructors, and current course members invited to the session; anyone else receives 404 not_found.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator, current course TA or instructor, or current invitee.

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

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): The collaboration session.

`data.id` (string, required, 1–255 characters): Opaque stable identifier.

`data.courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data.anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

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
    "title": "Why does my loop never stop?",
    "language": "python",
    "createdBy": "user_123",
    "participants": [
      {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "role": "creator",
        "permission": "edit"
      },
      {
        "userId": "user_456",
        "displayName": "Grace Hopper",
        "role": "invitee",
        "permission": "edit"
      }
    ],
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

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="updateCollaborationSession"></a>

### **`PATCH /api/v1/collaboration-sessions/{collaborationSessionId}`**

Changes an active session's title or language, or ends it with status ended. Only the session creator or current course staff may call it. Ending asks the collaboration server to persist the final text and waits up to 5 seconds for it to confirm; if it does not confirm in time, the session still ends with the most recently persisted text. Ended sessions become read-only and keep their final snapshot.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or current course TA or instructor.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaboration session.

#### Query parameters

None.

#### Request body

##### `UpdateCollaborationSessionRequest` (required)

`title` (string, optional, 1–120 characters): New title, 1 to 120 characters after trimming.

`language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, optional): Syntax-highlighting language. The editor never runs code.

`status` (literal ended, optional): Ends the session. Cannot be combined with title or language.

Provide at least one property. `status` cannot be combined with `title` or `language`.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): The updated collaboration session.

`data.id` (string, required, 1–255 characters): Opaque stable identifier.

`data.courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data.anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

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
    --header 'If-Match: "v1"' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Content-Type: application/json' \
    --data '{"language":"java"}'
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
    "title": "Why does my loop never stop?",
    "language": "java",
    "createdBy": "user_123",
    "participants": [
      {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "role": "creator",
        "permission": "edit"
      },
      {
        "userId": "user_456",
        "displayName": "Grace Hopper",
        "role": "invitee",
        "permission": "edit"
      }
    ],
    "endedAt": null,
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 2
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`forbidden`: The caller is not the session creator or course staff.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `409 Conflict`

`session_ended`: The collaboration session has ended.

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`validation_failed`: The request body is invalid.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="inviteCollaborationParticipant"></a>

### **`POST /api/v1/collaboration-sessions/{collaborationSessionId}/participants`**

Invites a current course member to an active session as an editor or, with `permission: "view"`, as a viewer whose connection is read-only. Only the session creator or current course staff may invite. Inviting an existing participant succeeds without duplication and leaves their permission unchanged; to change it, remove and re-invite them. Course staff always edit, whatever permission they were invited with. A new invitation emails the invitee a link to the session, naming who invited them, the session, and the course; the job worker sends it only if the session and course are still active and the invitee is still a participant and member when it runs. Inviting an existing participant sends no email.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or current course TA or instructor.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaboration session.

#### Query parameters

None.

#### Request body

##### `InviteCollaborationParticipantRequest` (required)

`userId` (string, required, 1–255 characters): Opaque stable identifier.

`permission` (enum: edit, view, optional; default edit): Edit or view only. Ignored when the user is already a participant.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): The collaboration session with its updated participants.

`data.id` (string, required, 1–255 characters): Opaque stable identifier.

`data.courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data.status` (enum: active, ended, required): Session lifecycle state.

`data.anchor` (object, required): A same-course post anchor. Thread conversations are not valid session anchors.

`data.anchor.postId` (string, required, 1–255 characters): Opaque stable identifier.

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; course staff always edit whatever they were invited with.

`data.endedAt` (string or null, required): End time; null while active.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/collaboration-sessions/collab_123/participants' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Content-Type: application/json' \
    --data '{"userId":"user_456"}'
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
    "title": "Why does my loop never stop?",
    "language": "python",
    "createdBy": "user_123",
    "participants": [
      {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "role": "creator",
        "permission": "edit"
      },
      {
        "userId": "user_456",
        "displayName": "Grace Hopper",
        "role": "invitee",
        "permission": "edit"
      }
    ],
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

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`forbidden`: The caller is not the session creator or course staff.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `409 Conflict`

`session_ended`: The collaboration session has ended.

`course_archived`: The course is archived.

##### `422 Unprocessable Content`

`not_course_member`: The user is not a current member of the course.

`invitee_cannot_read_post`: The session is on a private post, and the user is neither its author nor course staff.

`validation_failed`: The request body is invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="removeCollaborationParticipant"></a>

### **`DELETE /api/v1/collaboration-sessions/{collaborationSessionId}/participants/{userId}`**

Removes an invitee from an active session. Only the session creator or current course staff may remove. The invitee's unused tickets are revoked and their open connections close within 5 seconds.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or current course TA or instructor.

**Request media:** None.

#### Request headers

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`collaborationSessionId` (string, required, 1–255 characters): Identifies the collaboration session.

`userId` (string, required, 1–255 characters): Identifies the participant's user.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/collaboration-sessions/collab_123/participants/user_456' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`forbidden`: The caller is not the session creator or course staff.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `409 Conflict`

`session_ended`: The collaboration session has ended.

##### `422 Unprocessable Content`

`creator_not_removable`: The session creator cannot be removed.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="createCollaborationConnectionTicket"></a>

### **`POST /api/v1/collaboration-sessions/{collaborationSessionId}/connection-tickets`**

Creates a short-lived, one-use ticket for an active session in an active course. The ticket is bound to the authenticated login session, user, and collaboration session with `read` permission for a viewer and `write` otherwise, expires five minutes after issue, and is stored only as a hash. See the collaboration WebSocket protocol. Visible only to the session creator, current course TAs and instructors, and current course members invited to the session; anyone else receives 404 not_found.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator, current course TA or instructor, or current invitee, while the course and session are active.

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

`Cache-Control` (literal `no-store`): Prevents storage of the response.

#### Response body

##### `data` (object, required): One-use connection credentials.

`data.ticket` (string, required): Opaque one-use secret, sent as the Hocuspocus token when opening the WebSocket.

`data.webSocketUrl` (string, required): Credential-free WebSocket URL.

`data.documentId` (string, required, 1–255 characters): Document name to open, derived by the server as collaboration-session:{id}.

`data.expiresAt` (string, required): UTC expiry timestamp, five minutes after ticket issuance.

`data.permission` (enum: read, write, required): `read` for a viewer, whose connection is read-only; `write` otherwise.

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
    "webSocketUrl": "wss://app.example.edu/collaboration",
    "documentId": "collaboration-session:collab_123",
    "expiresAt": "2026-09-20T14:35:00Z",
    "permission": "write"
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `409 Conflict`

`session_ended`: The collaboration session has ended.

`course_archived`: The course is archived.

##### `429 Too Many Requests`

`rate_limited`: Too many connection tickets in the last 10 minutes, per `RATE_LIMIT_COLLABORATION_TICKET_USER` (default 300). The response includes `Retry-After`.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCollaborationSessionSnapshot"></a>

### **`GET /api/v1/collaboration-sessions/{collaborationSessionId}/snapshot`**

Retrieves the most recently persisted plain text of an active or ended session. Visible only to the session creator, current course TAs and instructors, and current course members invited to the session; anyone else receives 404 not_found.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator, current course TA or instructor, or current invitee.

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

`Cache-Control` (literal `no-store`): Prevents storage of the response.

#### Response body

##### `data` (object, required): The persisted collaboration text.

`data.collaborationSessionId` (string, required, 1–255 characters): Opaque stable collaboration-session identifier.

`data.documentId` (string, required, 1–255 characters): Document name derived from the collaboration session.

`data.sessionStatus` (enum: active, ended, required): Collaboration-session state when the snapshot was captured.

`data.content` (string, required, at most 200000 characters): Plain-text projection of Y.Text('content'), at most 200,000 characters.

`data.whiteboard` (array of objects, required, at most 5000 items): Non-deleted whiteboard elements as last persisted, in drawing order (fractional index, then id). Each is an Excalidraw 0.18 element with at least `id` and `type` (rectangle, ellipse, diamond, line, arrow, freedraw, or text); other fields are kept as drawn. See the [collaboration WebSocket protocol](collaboration-websocket.md#whiteboard) for the element rules.

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
    "documentId": "collaboration-session:collab_123",
    "sessionStatus": "active",
    "content": "for i in range(3):\n    print(i)\n",
    "whiteboard": [
      {
        "id": "r1",
        "type": "rectangle",
        "x": 40,
        "y": 30,
        "width": 120,
        "height": 60,
        "strokeColor": "#1e1e1e",
        "backgroundColor": "transparent",
        "version": 3,
        "versionNonce": 1046,
        "index": "a0",
        "isDeleted": false,
        "link": null
      }
    ],
    "persistedAt": "2026-09-20T14:31:58Z",
    "capturedAt": "2026-09-20T14:32:00Z"
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course, collaboration session, or participant is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.
