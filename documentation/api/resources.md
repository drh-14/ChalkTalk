## Resources

### Implemented course files

The Course Resources tab uses a sectioned catalog backed by immutable `course_files` and named external links. The region-based contracts below remain deferred. All routes require the `__Host-chalktalk_session` cookie; unsafe routes additionally require an allowed `Origin` and session-bound `X-CSRF-Token`. Error responses use the common `{ error: { code, message, requestId, details } }` envelope. Standalone file metadata follows the [CourseFile schema](../openapi.yaml#/components/schemas/CourseFile); no storage key, checksum or uploader identity is exposed.

#### `GET /api/v1/courses/{courseId}/files`

Current members (student, TA or instructor) of active or archived courses can list live original files. Missing, deleting and inaccessible courses return `404 not_found`; absent authentication returns `401 authentication_required`. Deleted files and other courses' files are excluded. Success is `200 application/json` with `Cache-Control: private, no-store`:

```json
{
  "data": [],
  "page": { "hasMore": false, "nextCursor": null }
}
```

`data` contains public file metadata. Optional `limit` is a single decimal integer from 1 to 100 (default 25). Optional `cursor` is the opaque `nextCursor` from this same course's preceding page (1–2048 characters). Unknown/repeated query fields, invalid limits and malformed or wrong-course cursors return `400 invalid_request`. Files sort by creation time descending, then file ID descending; cursor timestamps retain database precision. Concurrent new uploads appear on refresh; pagination is not a snapshot. `503 service_unavailable` indicates the file service is unavailable.

#### `POST /api/v1/courses/{courseId}/files`

Existing immutable upload: current instructors only, active course only; TA/student uploads return `403 permission_denied`, archived uploads `409 course_archived`. Supply exactly one multipart `file`, up to 100 MiB, a structurally validated PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. The original filename must be safe and at most 255 characters. Unsupported/malformed file content returns `415 unsupported_media_type`; invalid parts, filenames and keys return `422 validation_failed`, oversized content `413 payload_too_large`, and storage failure `503 service_unavailable`.

PDFs may contain clickable HTTP/HTTPS and relative URI links (including `./`, `../`, root-relative, query, fragment, and network-path references), internal GoTo page navigation, direct or named opening destinations, and ordinary tagged metadata. The original PDF bytes are preserved; relative links are not rewritten and may resolve differently depending on where the PDF is opened. A catalog URI base, if present, must be an absolute HTTP/HTTPS URL without credentials so relative links cannot inherit an unsafe scheme. Unsafe URL schemes such as `javascript:`, `file:`, `data:`, and `mailto:`, credential-bearing URLs, and active actions such as scripts, launches, embedded files, remote navigation, and automatic presentation-step actions are rejected. PDF structural inspection is bounded to 128 MiB of qpdf JSON output; an exceptionally complex file may therefore be rejected even below the upload-size limit.

PPTX files may contain ordinary HTTP/HTTPS or relative hyperlink relationships, with their original targets preserved. The upload validator rejects unsafe URL schemes, credential-bearing targets, external non-hyperlink relationships, macros, and executable or embedded package content. Relative links may resolve differently after the presentation is downloaded. DOCX external relationships remain disallowed.

Success returns `201` with `{ "data": <public file metadata> }` and `Location: /api/v1/courses/{courseId}/files/{fileId}/download`. Optional `Idempotency-Key` (1–255 characters) binds uploader, course, filename, declared type and original SHA-256 for 24 hours. An exact retry replays `201` while the file remains visible, including after archival. Changed input or a deleted file returns `409 idempotency_key_reused`; replay cannot resurrect files.

#### `GET /api/v1/courses/{courseId}/files/{fileId}/download`

Existing original-byte download: current members of active or archived courses only. Success streams exact original bytes with verified `Content-Type`, `Content-Length`, safe attachment `Content-Disposition`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. No public/presigned URL is returned. Missing, wrong-course, deleted or inaccessible files return `404 not_found`; storage failure returns `503 service_unavailable`.

#### `DELETE /api/v1/courses/{courseId}/files/{fileId}`

Existing standalone file deletion remains API-only: original uploader who is still a current instructor in an active course only. Success `204` atomically hides metadata and queues durable object deletion; later reads return `404`. Other instructors and non-instructors receive `403 permission_denied`; archived courses receive `409 course_archived`. The catalog's removal controls use course-scoped resource routes instead of this legacy endpoint.

### Implemented course resource catalog

The Resources page groups files and named external links under instructor-created sections. For catalog editing and visibility rules, see the [organized resource specification](../../openspec/specs/organized-course-resources/spec.md). External URLs are never fetched by the server.

<a id="listCourseResources"></a>

#### `GET /api/v1/courses/{courseId}/resources`

See the [OpenAPI list operation](../openapi.yaml#/paths/~1courses~1{courseId}~1resources/get) for query fields, response headers, pagination and errors. Entries use the [CourseResource schema](../openapi.yaml#/components/schemas/CourseResource); a resource's stable `id` and its current upload's `fileId` can differ.

Upload entries returned by catalog listing and single-resource reads include `textStatus`, defined by [ResourceTextStatus](../openapi.yaml#/components/schemas/ResourceTextStatus). Link entries have no such field. See [Search course resources](#searchCourseResources) for how extraction affects matching.

File titles download original bytes; named links open a new tab with `noopener noreferrer`.

<a id="createResource"></a>

#### `POST /api/v1/courses/{courseId}/resources`

See the [OpenAPI create operation](../openapi.yaml#/paths/~1courses~1{courseId}~1resources/post) for authentication, accepted link and catalog metadata, URL validation, idempotency, responses and errors. The server never fetches or previews the target.

<a id="searchCourseResources"></a>

#### `GET /api/v1/courses/{courseId}/resources/search`

Searches catalog resources by title and by text extracted from each upload's current file. Current members (student, TA or instructor) of active or archived courses only; requires the `__Host-chalktalk_session` cookie. Missing, deleting and inaccessible courses, including after membership removal, return `404 not_found`; missing authentication returns `401 authentication_required`; an unavailable service returns `503 service_unavailable`.

Extraction runs on catalog uploads and replacements and backfills existing live catalog files at migration time. PDFs use their text layer with OCR for scanned pages; PNG, JPEG and WebP use OCR; text and Markdown use UTF-8 decoding; DOCX and PPTX use document, slide and speaker-note text without OCR of embedded images. Extraction is self-hosted and does not send content to an external service. Course syllabus files and discussion attachments are outside this pipeline. For deployment limits, see [resource extraction configuration](../../README.md#environment-variables).

Query fields (each at most once; any other field returns `400 invalid_request`):

- `q` (required): trimmed and whitespace-collapsed, 1–200 Unicode code points.
- `limit` (optional): decimal integer from 1 to 50; default 20.
- `cursor` (optional): the opaque `nextCursor` from a previous page, 1–2048 characters. It is valid only for the same course, normalized query and viewer access level (staff or class); anything else returns `400 invalid_request`.

Matching uses word stems (`english` configuration, `websearch_to_tsquery` syntax) against resource titles and against the ready extracted text of each upload's current file. Title words also match close misspellings when the query uses no operators (quotes, `OR` or `-`) and every query word of three or more characters that is not a stop word closely matches the title. Links match on title only; their URLs are never fetched. Text from files whose `textStatus` is not `ready` is not searched, though their titles are. Results are ordered with title matches first, then by relevance, then resource ID.

Visibility is applied before ranking and pagination with the same rules as catalog reads: staff-only sections and items are visible only to current TAs and instructors, removed resources never match, and a replaced file's text stops matching as soon as the replacement commits. Pagination is not a snapshot of concurrent changes.

Success is `200 application/json` with `Cache-Control: private, no-store`:

```json
{
  "data": [
    {
      "resource": {
        "kind": "upload",
        "id": "0193f6a2-6c1e-7b3a-9f0e-2b1c4d5e6f70",
        "courseId": "0193f6a2-6c1e-7b3a-9f0e-2b1c4d5e6f71",
        "title": "Lecture 7",
        "fileId": "0193f6a2-6c1e-7b3a-9f0e-2b1c4d5e6f70",
        "fileName": "lecture-7.pdf",
        "mediaType": "application/pdf",
        "sizeBytes": 482113,
        "textStatus": "ready",
        "createdAt": "2026-10-31T14:00:00.000Z",
        "sectionId": null,
        "visibility": "class",
        "position": 0,
        "version": 1
      },
      "match": {
        "inTitle": false,
        "snippet": {
          "text": "Today we prove that the eigenvalues of a real symmetric matrix are real.",
          "highlights": [{ "start": 24, "length": 11 }]
        }
      }
    }
  ],
  "page": { "hasMore": false, "nextCursor": null }
}
```

`resource` is exactly the catalog entry. `match.inTitle` is true when the title matched (including a misspelling). `match.snippet` is null unless extracted text matched; otherwise `text` is a plain-text excerpt of at most 300 characters and `highlights` are ordered, non-overlapping `{ start, length }` ranges in UTF-16 code units into `text`. Snippets never contain markup; markup-like source text such as `<b>` is returned verbatim as text and must be rendered as text.

### Catalog sections, single resources and ordering

All routes below use the same authentication and errors as the catalog above. Reads are for current members of active or archived courses, with staff-only sections and items hidden from students and returned as `404`. Writes are for current instructors of active courses and require an allowed `Origin` and `X-CSRF-Token`; others receive `403 permission_denied`, and archived courses return `409 course_archived`. Conditional writes need `If-Match`: a missing header returns `428 precondition_required`, and a stale one returns `412 version_conflict`. Invalid input returns `422 validation_failed`. See the [OpenAPI document](../openapi.yaml) for schemas.

A section is `{ id, courseId, title, visibility, position, version }`. Titles are trimmed, nonblank and at most 200 characters; `visibility` is `class` (default) or `staff`.

<a id="listResourceSections"></a>

#### `GET /api/v1/courses/{courseId}/resource-sections`

Returns `200` with `{ data: [section], version }` in position order and an `ETag` of the catalog version. `version` is the value that ordering writes send as `If-Match`.

<a id="createResourceSection"></a>

#### `POST /api/v1/courses/{courseId}/resource-sections`

Accepts `{ title, visibility? }`. Returns `201` with `{ data: section }`, its `ETag` and a `Location`.

<a id="updateResourceSection"></a>

#### `PATCH /api/v1/courses/{courseId}/resource-sections/{sectionId}`

Accepts any of `{ title, visibility }` with the section's `If-Match`. Returns `200` with `{ data: section }`.

<a id="deleteResourceSection"></a>

#### `DELETE /api/v1/courses/{courseId}/resource-sections/{sectionId}`

Requires the section's `If-Match` and returns `204`. Its resources stay in the catalog, ungrouped. Items from a staff-only section become staff-only themselves, so removing a section never widens access.

<a id="reorderResourceSections"></a>

#### `PUT /api/v1/courses/{courseId}/resource-sections/order`

Accepts `{ ids }`, the complete current list of section IDs in the new order, with the catalog version as `If-Match`. Returns `200` with `{ data: { version } }`. A partial list returns `422`.

<a id="reorderResources"></a>

#### `PUT /api/v1/courses/{courseId}/resources/order`

Accepts `{ ids, sectionId }`, the complete list of live resources in one section (`null` for ungrouped), with the catalog version as `If-Match`. Returns `200` with `{ data: { version } }`.

<a id="getCourseResource"></a>

#### `GET /api/v1/courses/{courseId}/resources/{resourceId}`

Returns `200` with `{ data: resource }` and an `ETag` of the resource version. Hidden, removed and missing resources return `404`.

<a id="updateCourseResource"></a>

#### `PATCH /api/v1/courses/{courseId}/resources/{resourceId}`

Accepts any of `{ title, visibility, sectionId, url }` with the resource's `If-Match`. Omitted fields keep their values. Supplying `url` selects a new link revision while keeping the resource's identity, and retires an uploaded file that nothing else references.

<a id="deleteCourseResource"></a>

#### `DELETE /api/v1/courses/{courseId}/resources/{resourceId}`

Requires the resource's `If-Match` and returns `204`. The resource is hidden immediately, and unreferenced bytes are queued for worker cleanup.

<a id="uploadCourseResourceFile"></a>

#### `POST /api/v1/courses/{courseId}/resources/files`

Creates a catalog file from multipart `file` plus optional `title` (defaults to the filename), `sectionId` (empty means ungrouped) and `visibility` fields. File limits match [standalone uploads](#post-apiv1coursescourseidfiles). Returns `201` with `{ data: resource }`, an `ETag` and a `Location`, and queues text extraction. An optional `Idempotency-Key` replays the original response; reusing it for different input returns `409 idempotency_key_reused`.

<a id="replaceCourseResourceFile"></a>

#### `PUT /api/v1/courses/{courseId}/resources/{resourceId}/file`

Replaces the resource's file with the resource's `If-Match`, using the same multipart fields. Omitted metadata keeps its current value. Returns `200` with `{ data: resource }`. The resource ID is unchanged, the old file is retired, and text extraction is queued for the new one. See [course information and staff](course-information.md) for the syllabus.

### Deferred resource catalog operations

The following global `/resources/{resourceId}` and region contracts remain deferred; the implemented catalog uses course-scoped resource routes. Region-level OCR and descriptions remain deferred; whole-file text extraction is covered by [Search course resources](#searchCourseResources).

<a id="getResource"></a>

### **`GET /api/v1/resources/{resourceId}`**

Retrieves a resource. For a ready upload, downloadUrl is accompanied by expiresAt. For links, url is non-null.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`resourceId` (string, required, 1–255 characters): Identifies the resource resource.

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

##### `data` (object, required): Resource details.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.kind` (enum: upload, link, required): Immutable resource storage kind.

`data.title` (string, required): Human-readable title.

`data.description` (string, required): Human-readable description.

`data.status` (enum: processing, ready, failed, required): Resource ingestion state.

`data.mediaType` (string or null, required): Validated media type for uploads; null for links.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.url` (string or null, required): External link for link resources; null for uploads.

`data.downloadUrl` (string or null, required): Short-lived URL for ready uploads; null otherwise.

`data.expiresAt` (string or null, required): Download URL expiry when downloadUrl is present; null otherwise.

`data.sizeBytes` (integer or null, required): Upload size in bytes; null for link resources.

#### Example request

```bash
curl --request GET '/api/v1/resources/resource_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "resource_123",
    "courseId": "course_123",
    "kind": "upload",
    "title": "Lecture 1",
    "description": "Introduction slides",
    "status": "ready",
    "mediaType": "application/pdf",
    "url": null,
    "downloadUrl": "https://downloads.example/resource_123",
    "expiresAt": "2026-09-20T14:35:00Z",
    "sizeBytes": 1048576,
    "createdAt": "2026-09-20T12:00:00Z",
    "updatedAt": "2026-09-20T14:00:00Z",
    "version": 2
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The resource is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="updateResource"></a>

### **`PATCH /api/v1/resources/{resourceId}`**

Updates a resource. Use JSON to update a link resource. Use multipart to update an upload resource. kind cannot change. Replacing an upload restarts processing.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`resourceId` (string, required, 1–255 characters): Identifies the resource resource.

#### Query parameters

None.

#### Request body

##### `UpdateLinkResourceRequest` (required)

`title` (string, optional): Human-readable title.

`description` (string, optional): Human-readable description.

`url` (string, optional): Replacement external URL.

#### Multipart parts

`metadata` (`UpdateUploadResourceMetadata`, required, `application/json`): For an upload resource, metadata is application/json and an optional single file replaces the existing file. The file limit is 100 MiB.

`metadata.title` (string, optional): Human-readable title.

`metadata.description` (string, optional): Human-readable description.

`file` (file, optional): One upload up to 100 MiB; PDF, plain text, Markdown, PNG, JPEG, or WebP.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Resource details.

`data.id` (string, required): Opaque stable identifier.

`data.courseId` (string, required): Opaque stable identifier.

`data.kind` (enum: upload, link, required): Immutable resource storage kind.

`data.title` (string, required): Human-readable title.

`data.description` (string, required): Human-readable description.

`data.status` (enum: processing, ready, failed, required): Resource ingestion state.

`data.mediaType` (string or null, required): Validated media type for uploads; null for links.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.url` (string or null, required): External link for link resources; null for uploads.

`data.downloadUrl` (string or null, required): Short-lived URL for ready uploads; null otherwise.

`data.expiresAt` (string or null, required): Download URL expiry when downloadUrl is present; null otherwise.

`data.sizeBytes` (integer or null, required): Upload size in bytes; null for link resources.

#### Example request

```bash
curl --request PATCH '/api/v1/resources/resource_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://example.edu/revised-reading"}'
```

#### Example success response

```json
{
  "data": {
    "id": "resource_123",
    "courseId": "course_123",
    "kind": "link",
    "title": "Reference",
    "description": "External reading",
    "status": "ready",
    "mediaType": null,
    "url": "https://example.edu/revised-reading",
    "downloadUrl": null,
    "expiresAt": null,
    "sizeBytes": null,
    "createdAt": "2026-09-20T12:00:00Z",
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

`permission_denied`: An instructor role is required.

##### `409 Conflict`

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `413 Content Too Large`

`payload_too_large`: The replacement file exceeds 100 MiB.

##### `415 Unsupported Media Type`

`unsupported_media_type`: The replacement file type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: The fields do not match the resource kind.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteResource"></a>

### **`DELETE /api/v1/resources/{resourceId}`**

Deletes a resource. Logical deletion completes before the response: subsequent retrieval returns not_found. Stored bytes, OCR data, regions, and search records are cleaned asynchronously and never resurface.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`resourceId` (string, required, 1–255 characters): Identifies the resource resource.

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
curl --request DELETE '/api/v1/resources/resource_123' \
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

`permission_denied`: An instructor role is required.

##### `409 Conflict`

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

<a id="createResourceRegion"></a>

### **`POST /api/v1/resources/{resourceId}/regions`**

Creates a searchable region in a resource.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`resourceId` (string, required, 1–255 characters): Identifies the resource resource.

#### Query parameters

None.

#### Request body

##### `CreateRegionRequest` (required)

`page` (integer, required): One-based source page.

###### `bounds` (Bounds, required): See the named shape.

`bounds.x` (number, required): Left coordinate in page points.

`bounds.y` (number, required): Top coordinate in page points.

`bounds.width` (number, required): Region width in page points.

`bounds.height` (number, required): Region height in page points.

`title` (string, required): Human-readable title.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Resource region details.

`data.id` (string, required): Opaque stable identifier.

`data.resourceId` (string, required): Opaque stable identifier.

`data.page` (integer, required): One-based page number.

`data.bounds` (object, required): The region coordinates within the resource.

`data.title` (string, required): Human-readable title.

`data.status` (enum: processing, ready, failed, required): OCR and indexing state.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.

#### Example request

```bash
curl --request POST '/api/v1/resources/resource_123/regions' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"page":12,"bounds":{"x":120,"y":250,"width":600,"height":400},"title":"Recursion diagram"}'
```

#### Example success response

```json
{
  "data": {
    "id": "region_123",
    "resourceId": "resource_123",
    "page": 12,
    "bounds": {
      "x": 120,
      "y": 250,
      "width": 600,
      "height": 400
    },
    "title": "Recursion diagram",
    "status": "processing",
    "extractedText": null,
    "createdAt": "2026-09-20T13:00:00Z",
    "updatedAt": "2026-09-20T13:00:00Z",
    "version": 1
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: An instructor role is required.

##### `409 Conflict`

`idempotency_key_reused`: The idempotency key was already used with a different request body.

`course_archived`: The course is archived.

`resource_not_ready`: The resource is not ready for region creation.

##### `422 Unprocessable Content`

`validation_failed`: The page or bounds are invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listResourceRegions"></a>

### **`GET /api/v1/resources/{resourceId}/regions`**

Lists the regions in a resource.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`resourceId` (string, required, 1–255 characters): Identifies the resource resource.

#### Query parameters

`status` (enum: processing, ready, failed, optional; values processing, ready, failed): Filter by OCR/indexing state.

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

##### `data` (list of objects, required): Resource regions returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.resourceId` (string, required): Opaque stable identifier.

`data.page` (integer, required): One-based page number.

`data.bounds` (object, required): The region coordinates within the resource.

`data.title` (string, required): Human-readable title.

`data.status` (enum: processing, ready, failed, required): OCR and indexing state.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/resources/resource_123/regions' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "region_123",
      "resourceId": "resource_123",
      "page": 12,
      "bounds": {
        "x": 120,
        "y": 250,
        "width": 600,
        "height": 400
      },
      "title": "Recursion diagram",
      "status": "ready",
      "createdAt": "2026-09-20T13:00:00Z",
      "updatedAt": "2026-09-20T14:00:00Z",
      "version": 2
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

`not_found`: The resource is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="searchCourseResourceRegions"></a>

### **`GET /api/v1/courses/{courseId}/resource-regions`**

Searches resource regions in a course. Results are ordered by relevance. Only indexed ready regions are returned.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`q` (string, required; minimum length 1, maximum length 500): Trimmed non-empty search text.

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

##### `data` (list of objects, required): Resource regions returned by this request.

`data.id` (string, required): Opaque stable identifier.

`data.resourceId` (string, required): Opaque stable identifier.

`data.page` (integer, required): One-based page number.

`data.bounds` (object, required): The region coordinates within the resource.

`data.title` (string, required): Human-readable title.

`data.status` (enum: processing, ready, failed, required): OCR and indexing state.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/resource-regions?q=recursion' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "region_123",
      "resourceId": "resource_123",
      "page": 12,
      "bounds": {
        "x": 120,
        "y": 250,
        "width": 600,
        "height": 400
      },
      "title": "Recursion diagram",
      "status": "ready",
      "createdAt": "2026-09-20T13:00:00Z",
      "updatedAt": "2026-09-20T14:00:00Z",
      "version": 2
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

`invalid_request`: The query or pagination is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getResourceRegion"></a>

### **`GET /api/v1/resource-regions/{resourceRegionId}`**

Retrieves a resource region.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.

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

##### `data` (object, required): Resource region details.

`data.id` (string, required): Opaque stable identifier.

`data.resourceId` (string, required): Opaque stable identifier.

`data.page` (integer, required): One-based page number.

`data.bounds` (object, required): The region coordinates within the resource.

`data.title` (string, required): Human-readable title.

`data.status` (enum: processing, ready, failed, required): OCR and indexing state.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.

#### Example request

```bash
curl --request GET '/api/v1/resource-regions/region_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "region_123",
    "resourceId": "resource_123",
    "page": 12,
    "bounds": {
      "x": 120,
      "y": 250,
      "width": 600,
      "height": 400
    },
    "title": "Recursion diagram",
    "status": "ready",
    "extractedText": "A recursive function calls itself.",
    "createdAt": "2026-09-20T13:00:00Z",
    "updatedAt": "2026-09-20T14:00:00Z",
    "version": 2
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The region is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="updateResourceRegion"></a>

### **`PATCH /api/v1/resource-regions/{resourceRegionId}`**

Updates a resource region. Changing page or bounds restarts OCR and indexing.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.

#### Query parameters

None.

#### Request body

##### `UpdateRegionRequest` (required)

`page` (integer, optional): One-based source page.

###### `bounds` (Bounds, optional): See the named shape.

`bounds.x` (number, required): Left coordinate in page points.

`bounds.y` (number, required): Top coordinate in page points.

`bounds.width` (number, required): Region width in page points.

`bounds.height` (number, required): Region height in page points.

`title` (string, optional): Human-readable title.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Resource region details.

`data.id` (string, required): Opaque stable identifier.

`data.resourceId` (string, required): Opaque stable identifier.

`data.page` (integer, required): One-based page number.

`data.bounds` (object, required): The region coordinates within the resource.

`data.title` (string, required): Human-readable title.

`data.status` (enum: processing, ready, failed, required): OCR and indexing state.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.

#### Example request

```bash
curl --request PATCH '/api/v1/resource-regions/region_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"title":"Recursive-call diagram"}'
```

#### Example success response

```json
{
  "data": {
    "id": "region_123",
    "resourceId": "resource_123",
    "page": 12,
    "bounds": {
      "x": 120,
      "y": 250,
      "width": 600,
      "height": 400
    },
    "title": "Recursive-call diagram",
    "status": "ready",
    "extractedText": "A recursive function calls itself.",
    "createdAt": "2026-09-20T13:00:00Z",
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

`permission_denied`: An instructor role is required.

##### `409 Conflict`

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`validation_failed`: No valid field or bounds were supplied.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteResourceRegion"></a>

### **`DELETE /api/v1/resource-regions/{resourceRegionId}`**

Deletes a resource region. Logical deletion completes before the response; subsequent retrieval returns not_found. Search cleanup is asynchronous and the region never resurfaces.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.

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
curl --request DELETE '/api/v1/resource-regions/region_123' \
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

`permission_denied`: An instructor role is required.

##### `409 Conflict`

`course_archived`: The course is archived.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.
