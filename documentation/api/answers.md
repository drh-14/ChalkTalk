## Answers

Followup authors and answer contributors follow the shared [identity visibility policy](identity-visibility.md).

## Retained deleted answers and followups

Answer and followup read responses can contain active content or retained tombstones. `data.deleted` is the required discriminator. Active records set it to `false` and include the content fields documented below. An answer tombstone contains only `id`, `postId`, `kind`, `createdAt`, `updatedAt`, and `version`; a followup tombstone contains only `id`, `answerId`, `parentFollowupId`, `createdAt`, `updatedAt`, and `version`. Tombstones omit body content, contributors or authors, anonymity, attachments, and endorsement state. Create, update, and endorsement responses always contain active content.

#### Answer tombstone example

```json
{
  "id": "answer_123",
  "postId": "post_123",
  "kind": "student",
  "deleted": false,
  "deleted": true,
  "createdAt": "2026-09-20T14:00:00Z",
  "updatedAt": "2026-09-20T15:00:00Z",
  "version": 2
}
```

#### Followup tombstone example

```json
{
  "id": "followup_123",
  "answerId": "answer_123",
  "deleted": false,
  "parentFollowupId": null,
  "deleted": true,
  "createdAt": "2026-09-20T14:30:00Z",
  "updatedAt": "2026-09-20T15:00:00Z",
  "version": 2
}
```

<a id="createAnswer"></a>

### **`POST /api/v1/posts/{postId}/answers`**

Creates an answer to a question post and initializes its persistent Yjs document. In one atomic operation, the server creates the answer, initializes its document, and records exactly one `created` contributor event for the caller; all three changes roll back if any part fails. The server derives kind as student or staff from the caller’s role. Each question has at most one student answer and one staff answer. An idempotent replay returns the original result and does not create another document or contributor event.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

##### `CreateContentRequest` (required)

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Whether to hide contributors or author.

#### Multipart parts

`metadata` (`CreateContentRequest`, required, `application/json`): Send metadata as application/json and repeat attachments up to five times. Each file may be at most 25 MiB and must use an approved media type.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Whether to hide contributors or author.

`attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Answer details.

`data.id` (string, required): Opaque stable identifier.

`data.postId` (string, required): Opaque stable identifier.

`data.kind` (enum: student, staff, required): Shared answer group derived from contributor role.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the answer content fields below; `true` includes only `data.id`, `data.postId`, `data.kind`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown projection of the persistent answer Yjs document.

`data.contributors` (list of objects or null, required): Contributor identities. Null for every student viewing an anonymous answer; staff receive the full list.

`data.anonymous` (boolean, required): Whether the answer is anonymous; the contributors projection depends on the authenticated viewer.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.endorsedAt` (string or null, required): Endorsement timestamp, or null before endorsement.

`data.endorsedBy` (string or null, required): Endorsing staff user ID, or null before endorsement.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/posts/post_123/answers' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"bodyMarkdown":"Rayleigh scattering favors shorter wavelengths.","anonymous":false}'
```

#### Example success response

```json
{
  "data": {
    "id": "answer_123",
    "postId": "post_123",
    "kind": "student",
    "deleted": false,
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "contributors": [
      {
        "id": "user_123",
        "displayName": "Ada Lovelace"
      }
    ],
    "anonymous": false,
    "attachments": [],
    "endorsedAt": null,
    "endorsedBy": null,
    "createdAt": "2026-09-20T14:00:00Z",
    "updatedAt": "2026-09-20T14:00:00Z",
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

`answer_kind_exists`: The question already has the caller’s shared answer kind.

`course_archived`: The course is archived.

`not_a_question`: The post is not a question.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: The answer is invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listPostAnswers"></a>

### **`GET /api/v1/posts/{postId}/answers`**

Lists the answers to a question post. The data array contains at most one student answer and one staff answer.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None specific to this operation.

#### Response body

##### `data` (list of objects, required): Answers returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.postId` (string, required): Opaque stable identifier.

`data.kind` (enum: student, staff, required): Shared answer group derived from contributor role.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the answer content fields below; `true` includes only `data.id`, `data.postId`, `data.kind`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown projection of the persistent answer Yjs document.

`data.contributors` (list of objects or null, required): Contributor identities. Null for every student viewing an anonymous answer; staff receive the full list.

`data.anonymous` (boolean, required): Whether the answer is anonymous; the contributors projection depends on the authenticated viewer.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.endorsedAt` (string or null, required): Endorsement timestamp, or null before endorsement.

`data.endorsedBy` (string or null, required): Endorsing staff user ID, or null before endorsement.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request GET '/api/v1/posts/post_123/answers' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "answer_123",
      "postId": "post_123",
      "kind": "student",
      "deleted": false,
      "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
      "contributors": [
        {
          "id": "user_123",
          "displayName": "Ada Lovelace"
        }
      ],
      "anonymous": false,
      "attachments": [],
      "endorsedAt": null,
      "endorsedBy": null,
      "createdAt": "2026-09-20T14:00:00Z",
      "updatedAt": "2026-09-20T14:30:00Z",
      "version": 2
    }
  ]
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The post is absent or hidden.

##### `422 Unprocessable Content`

`not_a_question`: The post is not a question.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getAnswer"></a>

### **`GET /api/v1/answers/{answerId}`**

Retrieves an answer.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

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

##### `data` (object, required): Answer details.

`data.id` (string, required): Opaque stable identifier.

`data.postId` (string, required): Opaque stable identifier.

`data.kind` (enum: student, staff, required): Shared answer group derived from contributor role.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the answer content fields below; `true` includes only `data.id`, `data.postId`, `data.kind`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown projection of the persistent answer Yjs document.

`data.contributors` (list of objects or null, required): Contributor identities. Null for every student viewing an anonymous answer; staff receive the full list.

`data.anonymous` (boolean, required): Whether the answer is anonymous; the contributors projection depends on the authenticated viewer.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.endorsedAt` (string or null, required): Endorsement timestamp, or null before endorsement.

`data.endorsedBy` (string or null, required): Endorsing staff user ID, or null before endorsement.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request GET '/api/v1/answers/answer_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "answer_123",
    "postId": "post_123",
    "kind": "student",
    "deleted": false,
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "contributors": [
      {
        "id": "user_123",
        "displayName": "Ada Lovelace"
      }
    ],
    "anonymous": false,
    "attachments": [],
    "endorsedAt": null,
    "endorsedBy": null,
    "createdAt": "2026-09-20T14:00:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 2
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The answer is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="updateAnswer"></a>

### **`PATCH /api/v1/answers/{answerId}`**

Updates answer metadata and attachments. Edit `bodyMarkdown` through the answer collaboration connection endpoint.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Students edit the shared student answer; staff edit the shared staff answer.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

#### Query parameters

None.

#### Request body

##### `UpdateAnswerRequest` (required)

`anonymous` (boolean, optional): Whether to hide contributors.

`removeAttachmentIds` (list of string, optional): Existing attachments to remove.

#### Multipart parts

`metadata` (`UpdateAnswerRequest`, optional, `application/json`): Send metadata as application/json when changing answer metadata or removing attachments. It is not required when the request adds one or more attachments.

`metadata.anonymous` (boolean, optional): Whether to hide contributors.

`metadata.removeAttachmentIds` (list of string, optional): Existing attachments to remove.

`attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP. At least one metadata field or attachment part is required.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Answer details.

`data.id` (string, required): Opaque stable identifier.

`data.postId` (string, required): Opaque stable identifier.

`data.kind` (enum: student, staff, required): Shared answer group derived from contributor role.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the answer content fields below; `true` includes only `data.id`, `data.postId`, `data.kind`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown projection of the persistent answer Yjs document.

`data.contributors` (list of objects or null, required): Contributor identities. Null for every student viewing an anonymous answer; staff receive the full list.

`data.anonymous` (boolean, required): Whether the answer is anonymous; the contributors projection depends on the authenticated viewer.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.endorsedAt` (string or null, required): Endorsement timestamp, or null before endorsement.

`data.endorsedBy` (string or null, required): Endorsing staff user ID, or null before endorsement.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request PATCH '/api/v1/answers/answer_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"anonymous":false,"removeAttachmentIds":["attachment_old"]}'
```

#### Example success response

```json
{
  "data": {
    "id": "answer_123",
    "postId": "post_123",
    "kind": "student",
    "deleted": false,
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "contributors": [
      {
        "id": "user_123",
        "displayName": "Ada Lovelace"
      }
    ],
    "anonymous": false,
    "attachments": [],
    "endorsedAt": null,
    "endorsedBy": null,
    "createdAt": "2026-09-20T14:00:00Z",
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

`permission_denied`: The caller cannot edit this shared answer.

##### `409 Conflict`

`answer_endorsed`: Endorsed answers are immutable.

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: No metadata or attachment change was supplied.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createAnswerCollaborationConnectionTicket"></a>

### **`POST /api/v1/answers/{answerId}/collaboration-connection-tickets`**

Creates a five-minute, one-use ticket for editing an answer over WebSocket. Students may edit student answers and staff may edit staff answers while the course is active and the answer is editable. See [Collaboration WebSocket protocol](collaboration-websocket.md).

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course member whose role matches the answer kind, while the course is active and the answer is unendorsed.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

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

`data.documentId` (string, required): Document identifier derived by the server from the answer.

`data.expiresAt` (string, required): UTC expiry timestamp, five minutes after issuance.

#### Example request

```bash
curl --request POST '/api/v1/answers/answer_123/collaboration-connection-tickets' \
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
    "documentId": "answer_123",
    "expiresAt": "2026-09-20T14:35:00Z"
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: The caller’s role does not match the answer kind.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The answer is absent or hidden.

##### `409 Conflict`

`answer_endorsed`: Endorsed answers are immutable.

`course_archived`: The course is not active.

`course_deleting`: The course is not active.

##### `429 Too Many Requests`

`rate_limited`: Too many ticket requests were made; retry after the duration in `Retry-After`.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteAnswer"></a>

### **`DELETE /api/v1/answers/{answerId}`**

Deletes an answer. A tombstone is retained when needed to preserve followups. On success, the answer is no longer editable. A temporary failure returns `503 Service Unavailable` and leaves the answer unchanged.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** TA or instructor.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/answers/answer_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: A staff role is required.

##### `409 Conflict`

`answer_endorsed`: Endorsed answers are immutable.

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="endorseAnswer"></a>

### **`PUT /api/v1/answers/{answerId}/endorsement`**

Endorses an answer and makes it unavailable for further edits. Repeating a successful endorsement is idempotent when `If-Match` identifies the current endorsed revision. A temporary failure returns `503 Service Unavailable` and leaves the answer unchanged.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** TA or instructor.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

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

##### `data` (object, required): Answer details.

`data.id` (string, required): Opaque stable identifier.

`data.postId` (string, required): Opaque stable identifier.

`data.kind` (enum: student, staff, required): Shared answer group derived from contributor role.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the answer content fields below; `true` includes only `data.id`, `data.postId`, `data.kind`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown projection of the persistent answer Yjs document.

`data.contributors` (list of objects or null, required): Contributor identities. Null for every student viewing an anonymous answer; staff receive the full list.

`data.anonymous` (boolean, required): Whether the answer is anonymous; the contributors projection depends on the authenticated viewer.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.endorsedAt` (string or null, required): Endorsement timestamp, or null before endorsement.

`data.endorsedBy` (string or null, required): Endorsing staff user ID, or null before endorsement.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request PUT '/api/v1/answers/answer_123/endorsement' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"'
```

#### Example success response

```json
{
  "data": {
    "id": "answer_123",
    "postId": "post_123",
    "kind": "student",
    "deleted": false,
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "contributors": [
      {
        "id": "user_123",
        "displayName": "Ada Lovelace"
      }
    ],
    "anonymous": false,
    "attachments": [],
    "endorsedAt": "2026-09-20T14:40:00Z",
    "endorsedBy": "user_456",
    "createdAt": "2026-09-20T14:00:00Z",
    "updatedAt": "2026-09-20T14:40:00Z",
    "version": 4
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `409 Conflict`

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`validation_failed`: The answer cannot be endorsed.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createAnswerFollowup"></a>

### **`POST /api/v1/answers/{answerId}/followups`**

Creates a followup to an answer.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

#### Query parameters

None.

#### Request body

##### `CreateContentRequest` (required)

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Whether to hide contributors or author.

#### Multipart parts

`metadata` (`CreateContentRequest`, required, `application/json`): Send metadata as application/json and repeat attachments up to five times. Each file may be at most 25 MiB and must use an approved media type.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Whether to hide contributors or author.

`attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Followup details.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/answers/answer_123/followups' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"bodyMarkdown":"Rayleigh scattering favors shorter wavelengths.","anonymous":false}'
```

#### Example success response

```json
{
  "data": {
    "id": "followup_123",
    "answerId": "answer_123",
    "deleted": false,
    "parentFollowupId": null,
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "attachments": [],
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

`parent_archived`: The answer or course is archived.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: The followup is invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listAnswerFollowups"></a>

### **`GET /api/v1/answers/{answerId}/followups`**

Lists the direct followups to an answer. Returns direct followups only. Nested followups are addressed through their parent.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`answerId` (string, required, 1–255 characters): Identifies the answer resource.

#### Query parameters

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

##### `data` (list of objects, required): Followups returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/answers/answer_123/followups' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "followup_123",
      "answerId": "answer_123",
      "deleted": false,
      "parentFollowupId": null,
      "bodyMarkdown": "Does this also explain sunsets?",
      "author": {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "anonymous": false,
        "deleted": false
      },
      "anonymous": false,
      "attachments": [],
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

`invalid_request`: Pagination is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The answer is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createNestedFollowup"></a>

### **`POST /api/v1/followups/{followupId}/followups`**

Creates a child followup under another followup.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`followupId` (string, required, 1–255 characters): Identifies the followup resource.

#### Query parameters

None.

#### Request body

##### `CreateContentRequest` (required)

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Whether to hide contributors or author.

#### Multipart parts

`metadata` (`CreateContentRequest`, required, `application/json`): Send metadata as application/json and repeat attachments up to five times. Each file may be at most 25 MiB and must use an approved media type.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Whether to hide contributors or author.

`attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Followup details.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/followups/followup_123/followups' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"bodyMarkdown":"Rayleigh scattering favors shorter wavelengths.","anonymous":false}'
```

#### Example success response

```json
{
  "data": {
    "id": "followup_456",
    "answerId": "answer_123",
    "deleted": false,
    "parentFollowupId": "followup_123",
    "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "attachments": [],
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

`parent_archived`: The parent content or course is archived.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: The followup is invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listNestedFollowups"></a>

### **`GET /api/v1/followups/{followupId}/followups`**

Lists the direct child followups under a followup. Returns direct children of the specified followup only. Deeper descendants are addressed through their parent followup.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`followupId` (string, required, 1–255 characters): Identifies the parent followup resource.

#### Query parameters

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

##### `data` (list of objects, required): Followups returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/followups/followup_123/followups' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "followup_456",
      "answerId": "answer_123",
      "deleted": false,
      "parentFollowupId": "followup_123",
      "bodyMarkdown": "Rayleigh scattering favors shorter wavelengths.",
      "author": {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "anonymous": false,
        "deleted": false
      },
      "anonymous": false,
      "attachments": [],
      "createdAt": "2026-09-20T14:35:00Z",
      "updatedAt": "2026-09-20T14:35:00Z",
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

`invalid_request`: Pagination is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The parent followup is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getFollowup"></a>

### **`GET /api/v1/followups/{followupId}`**

Retrieves a followup.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`followupId` (string, required, 1–255 characters): Identifies the followup resource.

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

##### `data` (object, required): Followup details.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request GET '/api/v1/followups/followup_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "followup_123",
    "answerId": "answer_123",
    "deleted": false,
    "parentFollowupId": null,
    "bodyMarkdown": "Does this also explain sunsets?",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "attachments": [],
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

`not_found`: The followup is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="updateFollowup"></a>

### **`PATCH /api/v1/followups/{followupId}`**

Updates a followup.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Author or staff.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`followupId` (string, required, 1–255 characters): Identifies the followup resource.

#### Query parameters

None.

#### Request body

##### `UpdateContentRequest` (required)

`bodyMarkdown` (string, optional): Markdown content.

`anonymous` (boolean, optional): Whether to hide contributors or author.

`removeAttachmentIds` (list of string, optional): Existing attachments to remove.

#### Multipart parts

`metadata` (`UpdateContentRequest`, optional, `application/json`): Send metadata as application/json when changing followup fields or removing attachments. It is not required when the request adds one or more attachments.

`metadata.bodyMarkdown` (string, optional): Markdown content.

`metadata.anonymous` (boolean, optional): Whether to hide contributors or author.

`metadata.removeAttachmentIds` (list of string, optional): Existing attachments to remove.

`attachments` (repeated file part, optional): Up to five files, 25 MiB each; PDF, plain text, Markdown, PNG, JPEG, or WebP. At least one metadata field or attachment part is required.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Followup details.

`data.id` (string, required): Opaque stable identifier.

`data.answerId` (string, required): Opaque stable identifier.

`data.parentFollowupId` (string or null, required): Parent followup ID, or null for a direct answer followup.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the followup content fields below; `true` includes only `data.id`, `data.answerId`, `data.parentFollowupId`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer.

`data.anonymous` (boolean, required): Whether the author is hidden.

`data.attachments` (list of objects, required): Attached files.

`data.attachments[].id` (string, required): Opaque stable attachment identifier.

`data.attachments[].filename` (string, required): Original file name.

`data.attachments[].mediaType` (enum: application/pdf, text/plain, text/markdown, image/png, image/jpeg, image/webp, required): Validated file media type.

`data.attachments[].sizeBytes` (integer, required): Uploaded file size in bytes.

`data.attachments[].status` (enum: processing, ready, rejected, failed, required): Attachment processing state.

`data.attachments[].downloadUrl` (string or null, required): Short-lived download URL when status is ready; otherwise null.

`data.attachments[].expiresAt` (string or null, required): UTC expiry timestamp for downloadUrl; otherwise null.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request PATCH '/api/v1/followups/followup_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"bodyMarkdown":"Updated collaborative explanation.","removeAttachmentIds":["attachment_old"]}'
```

#### Example success response

```json
{
  "data": {
    "id": "followup_123",
    "answerId": "answer_123",
    "deleted": false,
    "parentFollowupId": null,
    "bodyMarkdown": "Updated collaborative explanation.",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "attachments": [],
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

`permission_denied`: The caller cannot edit this followup.

##### `409 Conflict`

`parent_archived`: The parent content or course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: No valid edit was supplied.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteFollowup"></a>

### **`DELETE /api/v1/followups/{followupId}`**

Deletes a followup. A bodyless, authorless tombstone is retained when it has child followups.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Author or staff.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`followupId` (string, required, 1–255 characters): Identifies the followup resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/followups/followup_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: The caller cannot delete this followup.

##### `409 Conflict`

`parent_archived`: The parent content or course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.
