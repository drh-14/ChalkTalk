## Collaboration Sessions

Live sessions are private, course-scoped shared code and whiteboard documents, independent of posts and Threads. A session nobody has been connected to for `COLLABORATION_IDLE_END_MINUTES` (default 120) ends automatically. Only current course members with an explicit participant row can discover, open, or receive tickets for it; nonparticipants, including course staff, receive `404 not_found`. Existing sessions retain their IDs, documents, and roster when detached from posts. Editing happens over the [collaboration WebSocket](collaboration-websocket.md) after obtaining a one-use connection ticket.

<a id="createCollaborationSession"></a>

### **`POST /api/v1/courses/{courseId}/collaboration-sessions`**

Creates an active, private live session in an active course. The creator becomes the first participant. The text starts empty. Create a separate one-use connection ticket before opening the collaboration WebSocket.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Any current member of an active course.

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

`title` (string, required, 1–120 characters): Session title, 1 to 120 characters after trimming.

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

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data.finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` when the collaboration server confirms the final persisted snapshot; `false` when confirmation fails or the session ended before this field existed.

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
    --data '{"title":"Office hours workspace","language":"python"}'
```

#### Example success response

```json
{
  "data": {
    "id": "collab_123",
    "courseId": "course_123",
    "status": "active",
    "title": "Office hours workspace",
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
    "finalSnapshotConfirmed": null,
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

Lists the course's sessions in which the caller currently participates, newest first. Nonparticipant sessions, including those visible to no staff member, are excluded before pagination and `hasMore` are calculated.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member. Results include only sessions with a current participant row for the caller.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

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

##### `data` (list of objects, required): Collection of CollaborationSessionSummary records.

`data[].id` (string, required, 1–255 characters): Opaque stable identifier.

`data[].courseId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].status` (enum: active, ended, required): Session lifecycle state.

`data[].title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data[].language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data[].createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants` (list of objects, required): The creator and invited participants.

`data[].participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants[].displayName` (string, required): Account display name.

`data[].participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data[].participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data[].finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` for a confirmed final snapshot; `false` for an unconfirmed or legacy-ended snapshot.

`data[].endedAt` (string or null, required): End time; null while active.

`data[].createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].version` (integer, required): Revision number used to construct the resource ETag.

##### `page` (object, required): Cursor pagination state.

`page.nextCursor` (string or null, required): Opaque cursor for the next page.

`page.hasMore` (boolean, required): Whether another page exists.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/collaboration-sessions?status=active' \
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
      "title": "Office hours workspace",
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
      "finalSnapshotConfirmed": null,
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

Lists sessions in which the caller currently participates, newest first, across courses of which the caller is still a member. Staff do not see nonparticipant sessions here or in the [course list](#listCourseCollaborationSessions). Post deletion and merging do not change session visibility.

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

`data[].title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data[].language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data[].createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants` (list of objects, required): The creator and invited participants.

`data[].participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data[].participants[].displayName` (string, required): Account display name.

`data[].participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data[].participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data[].finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` for a confirmed final snapshot; `false` for an unconfirmed or legacy-ended snapshot.

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
      "title": "Office hours workspace",
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
      "finalSnapshotConfirmed": null,
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

Retrieves a collaboration session for a current participant. Use the connection-ticket endpoint to obtain short-lived WebSocket credentials for an active session. Nonparticipants, including staff, receive `404 not_found`.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member who is a session participant.

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

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data.finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` when the collaboration server confirms the final persisted snapshot; `false` when confirmation fails or the session ended before this field existed.

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
    "title": "Office hours workspace",
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
    "finalSnapshotConfirmed": null,
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

Changes an active session's title or language, or ends it with status ended. Only the creator or a current TA/instructor who is also a participant may call it. Ending preserves the last persisted document; `finalSnapshotConfirmed` is `true` only if the collaboration server confirms its final flush. Otherwise the read-only snapshot shows a last-saved warning. Previously ended sessions are conservatively unconfirmed. Ending asks the collaboration server to persist the final text and waits up to 5 seconds for it to confirm; if it does not confirm in time, the session still ends with the most recently persisted text. Ended sessions become read-only and keep their final snapshot.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or participating current course TA/instructor.

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

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data.finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` when the collaboration server confirms the final persisted snapshot; `false` when confirmation fails or the session ended before this field existed.

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
    "title": "Office hours workspace",
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
    "finalSnapshotConfirmed": null,
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

`forbidden`: The caller is not the creator or participating course staff.

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

Invites a current course member to an active session as an editor or, with `permission: "view"`, as a viewer whose connection is read-only. Any current participant may invite. Inviting an existing participant succeeds without duplication and leaves their permission unchanged; to change it, the creator or participating staff must remove and re-invite them. Invited staff retain their assigned View/Edit permission. A new invitation emails the invitee a link to the session, naming who invited them, the session, and the course; the job worker sends it only if the session and course are still active and the invitee is still a participant and member when it runs. Inviting an existing participant sends no email.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Any current participant in an active course.

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

`data.title` (string, required, 1–120 characters): Session title, trimmed, 1 to 120 characters.

`data.language` (enum: plaintext, python, java, c, cpp, javascript, typescript, sql, required): Syntax-highlighting language. The editor never runs code.

`data.createdBy` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants` (list of objects, required): The creator and invited participants.

`data.participants[].userId` (string, required, 1–255 characters): Opaque stable identifier.

`data.participants[].displayName` (string, required): Account display name.

`data.participants[].role` (enum: creator, invitee, required): The participant's role in the session.

`data.participants[].permission` (enum: edit, view, required): Whether the participant edits or only views. The creator always edits; staff invited with View remain read-only.

`data.finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` when the collaboration server confirms the final persisted snapshot; `false` when confirmation fails or the session ended before this field existed.

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
    "title": "Office hours workspace",
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
    "finalSnapshotConfirmed": null,
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

`session_ended`: The collaboration session has ended.

`course_archived`: The course is archived.

##### `422 Unprocessable Content`

`not_course_member`: The user is not a current member of the course.

`validation_failed`: The request body is invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

---

<a id="removeCollaborationParticipant"></a>

### **`DELETE /api/v1/collaboration-sessions/{collaborationSessionId}/participants/{userId}`**

Removes an invitee from an active session. Only the creator or participating current course staff may remove. The invitee's unused tickets are revoked and their open connections close within 5 seconds.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Session creator or participating current course TA/instructor.

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

`forbidden`: The caller is not the creator or participating course staff.

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

Creates a short-lived, one-use ticket for an active session in an active course. The ticket is bound to the authenticated login session, user, and collaboration session with `read` permission for a View participant and `write` for an Edit participant, expires five minutes after issue, and is stored only as a hash. See the collaboration WebSocket protocol. Nonparticipants, including course staff, receive `404 not_found`.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member who is a participant, while the course and session are active.

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

Retrieves the most recently persisted plain text of an active or ended session for a current participant. Nonparticipants, including course staff, receive `404 not_found`.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member who is a session participant.

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

`data.finalSnapshotConfirmed` (boolean or null, required): `null` while active or ending; `true` for a confirmed final snapshot; `false` for an unconfirmed or legacy-ended snapshot.

`data.lastSavedWarning` (boolean, required): True for an ended session without a confirmed final snapshot, warning that recent edits may be missing.

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
    "finalSnapshotConfirmed": null,
    "lastSavedWarning": false,
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
