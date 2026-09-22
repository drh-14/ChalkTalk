## Resources

<a id="createResource"></a>
- **`POST /api/v1/courses/{courseId}/resources`**
  - Description: Creates a resource in a course. Use application/json for a link resource or multipart/form-data for an upload resource. kind is immutable; convert kinds by deleting and creating a resource.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Instructor.
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
    - Schema: `CreateLinkResourceRequest` (required).
    - `kind` (literal link, required): See the named shape.
    - `title` (string, required): Human-readable title.
    - `description` (string, required): Human-readable description.
    - `url` (string, required): External resource URL.
  - Multipart parts:
    - `metadata` (`CreateUploadResourceMetadata`, required, `application/json`): Upload exactly one file, at most 100 MiB, as PDF, plain text, Markdown, PNG, JPEG, or WebP. metadata is application/json.
    - `metadata.kind` (literal upload, required): See the named shape.
    - `metadata.title` (string, required): Human-readable title.
    - `metadata.description` (string, required): Human-readable description.
    - `file` (file, required): One upload up to 100 MiB; PDF, plain text, Markdown, PNG, JPEG, or WebP.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
    - `ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Resource details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.kind` (enum: upload, link, required): Immutable resource storage kind.
      - `data.title` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: processing, ready, failed, required): Resource ingestion state.
      - `data.mediaType` (string or null, required): Validated media type for uploads; null for links.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.url` (string or null, required): External link for link resources; null for uploads.
      - `data.downloadUrl` (string or null, required): Short-lived URL for ready uploads; null otherwise.
      - `data.expiresAt` (string or null, required): Download URL expiry when downloadUrl is present; null otherwise.
      - `data.sizeBytes` (integer or null, required): Upload size in bytes; null for link resources.
  - Example request:

    ```bash
    curl --request POST '/api/v1/courses/course_123/resources' \
        --header 'Accept: application/json' \
        --header 'Origin: https://app.example.edu' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session' \
        --header 'X-CSRF-Token: opaque_csrf_token' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"kind":"link","title":"Reference","description":"External reading","url":"https://example.edu/reading"}'
    ```

  - Example success response:

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
        "url": "https://example.edu/reading",
        "downloadUrl": null,
        "expiresAt": null,
        "sizeBytes": null,
        "createdAt": "2026-09-20T12:00:00Z",
        "updatedAt": "2026-09-20T12:00:00Z",
        "version": 1
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: An instructor role is required.
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
      - `course_archived`: The course is archived.
    - `413 Content Too Large`:
      - `payload_too_large`: The uploaded file exceeds 100 MiB.
    - `415 Unsupported Media Type`:
      - `unsupported_media_type`: The upload media type is unsupported.
    - `422 Unprocessable Content`:
      - `validation_failed`: Resource metadata is invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listCourseResources"></a>
- **`GET /api/v1/courses/{courseId}/resources`**
  - Description: Lists the resources in a course.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `kind` (enum: upload, link, optional; values upload, link): Filter by storage kind.
    - `status` (enum: processing, ready, failed, optional; values processing, ready, failed): Filter by ingestion state.
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
    - `data` (list of objects, required): Resources returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.kind` (enum: upload, link, required): Immutable resource storage kind.
      - `data.title` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: processing, ready, failed, required): Resource ingestion state.
      - `data.mediaType` (string or null, required): Validated media type for uploads; null for links.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/resources' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "resource_123",
          "courseId": "course_123",
          "kind": "upload",
          "title": "Lecture 1",
          "description": "Introduction slides",
          "status": "ready",
          "mediaType": "application/pdf",
          "createdAt": "2026-09-20T12:00:00Z",
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

<a id="getResource"></a>
- **`GET /api/v1/resources/{resourceId}`**
  - Description: Retrieves a resource. For a ready upload, downloadUrl is accompanied by expiresAt. For links, url is non-null.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `resourceId` (string, required, 1–255 characters): Identifies the resource resource.
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
    - `data` (object, required): Resource details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.kind` (enum: upload, link, required): Immutable resource storage kind.
      - `data.title` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: processing, ready, failed, required): Resource ingestion state.
      - `data.mediaType` (string or null, required): Validated media type for uploads; null for links.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.url` (string or null, required): External link for link resources; null for uploads.
      - `data.downloadUrl` (string or null, required): Short-lived URL for ready uploads; null otherwise.
      - `data.expiresAt` (string or null, required): Download URL expiry when downloadUrl is present; null otherwise.
      - `data.sizeBytes` (integer or null, required): Upload size in bytes; null for link resources.
  - Example request:

    ```bash
    curl --request GET '/api/v1/resources/resource_123' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The resource is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateResource"></a>
- **`PATCH /api/v1/resources/{resourceId}`**
  - Description: Updates a resource. Use JSON to update a link resource. Use multipart to update an upload resource. kind cannot change. Replacing an upload restarts processing.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Instructor.
  - Request media: `application/json`, `multipart/form-data`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `resourceId` (string, required, 1–255 characters): Identifies the resource resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateLinkResourceRequest` (required).
    - `title` (string, optional): Human-readable title.
    - `description` (string, optional): Human-readable description.
    - `url` (string, optional): Replacement external URL.
  - Multipart parts:
    - `metadata` (`UpdateUploadResourceMetadata`, required, `application/json`): For an upload resource, metadata is application/json and an optional single file replaces the existing file. The file limit is 100 MiB.
    - `metadata.title` (string, optional): Human-readable title.
    - `metadata.description` (string, optional): Human-readable description.
    - `file` (file, optional): One upload up to 100 MiB; PDF, plain text, Markdown, PNG, JPEG, or WebP.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Resource details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.courseId` (string, required): Opaque stable identifier.
      - `data.kind` (enum: upload, link, required): Immutable resource storage kind.
      - `data.title` (string, required): Human-readable title.
      - `data.description` (string, required): Human-readable description.
      - `data.status` (enum: processing, ready, failed, required): Resource ingestion state.
      - `data.mediaType` (string or null, required): Validated media type for uploads; null for links.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.url` (string or null, required): External link for link resources; null for uploads.
      - `data.downloadUrl` (string or null, required): Short-lived URL for ready uploads; null otherwise.
      - `data.expiresAt` (string or null, required): Download URL expiry when downloadUrl is present; null otherwise.
      - `data.sizeBytes` (integer or null, required): Upload size in bytes; null for link resources.
  - Example request:

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

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: An instructor role is required.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `413 Content Too Large`:
      - `payload_too_large`: The replacement file exceeds 100 MiB.
    - `415 Unsupported Media Type`:
      - `unsupported_media_type`: The replacement file type is unsupported.
    - `422 Unprocessable Content`:
      - `validation_failed`: The fields do not match the resource kind.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteResource"></a>
- **`DELETE /api/v1/resources/{resourceId}`**
  - Description: Deletes a resource. Logical deletion completes before the response: subsequent retrieval returns not_found. Stored bytes, OCR data, regions, and search records are cleaned asynchronously and never resurface.
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
    - `resourceId` (string, required, 1–255 characters): Identifies the resource resource.
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
    curl --request DELETE '/api/v1/resources/resource_123' \
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
      - `permission_denied`: An instructor role is required.
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

<a id="createResourceRegion"></a>
- **`POST /api/v1/resources/{resourceId}/regions`**
  - Description: Creates a searchable region in a resource.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Instructor.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
    - `Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours.
    - `X-CSRF-Token` (required, string): Stable opaque token bound to the current session.
  - Path parameters:
    - `resourceId` (string, required, 1–255 characters): Identifies the resource resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateRegionRequest` (required).
    - `page` (integer, required): One-based source page.
    - `bounds` (Bounds, required): See the named shape.
      - `bounds.x` (number, required): Left coordinate in page points.
      - `bounds.y` (number, required): Top coordinate in page points.
      - `bounds.width` (number, required): Region width in page points.
      - `bounds.height` (number, required): Region height in page points.
    - `title` (string, required): Human-readable title.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
    - `ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Resource region details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.resourceId` (string, required): Opaque stable identifier.
      - `data.page` (integer, required): One-based page number.
      - `data.bounds` (object, required): The region coordinates within the resource.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: processing, ready, failed, required): OCR and indexing state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.
  - Example request:

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

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: An instructor role is required.
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
      - `course_archived`: The course is archived.
      - `resource_not_ready`: The resource is not ready for region creation.
    - `422 Unprocessable Content`:
      - `validation_failed`: The page or bounds are invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="listResourceRegions"></a>
- **`GET /api/v1/resources/{resourceId}/regions`**
  - Description: Lists the regions in a resource.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `resourceId` (string, required, 1–255 characters): Identifies the resource resource.
  - Query parameters:
    - `status` (enum: processing, ready, failed, optional; values processing, ready, failed): Filter by OCR/indexing state.
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
    - `data` (list of objects, required): Resource regions returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.resourceId` (string, required): Opaque stable identifier.
      - `data.page` (integer, required): One-based page number.
      - `data.bounds` (object, required): The region coordinates within the resource.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: processing, ready, failed, required): OCR and indexing state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/resources/resource_123/regions' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

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
  - Errors:
    - `400 Bad Request`:
      - `invalid_request`: Filters or pagination are invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The resource is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="searchCourseResourceRegions"></a>
- **`GET /api/v1/courses/{courseId}/resource-regions`**
  - Description: Searches resource regions in a course. Results are ordered by relevance. Only indexed ready regions are returned.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `courseId` (string, required, 1–255 characters): Identifies the course resource.
  - Query parameters:
    - `q` (string, required; minimum length 1, maximum length 500): Trimmed non-empty search text.
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
    - `data` (list of objects, required): Resource regions returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.resourceId` (string, required): Opaque stable identifier.
      - `data.page` (integer, required): One-based page number.
      - `data.bounds` (object, required): The region coordinates within the resource.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: processing, ready, failed, required): OCR and indexing state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/courses/course_123/resource-regions?q=recursion' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

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
  - Errors:
    - `400 Bad Request`:
      - `invalid_request`: The query or pagination is invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The course is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getResourceRegion"></a>
- **`GET /api/v1/resource-regions/{resourceRegionId}`**
  - Description: Retrieves a resource region.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Course member.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - `resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.
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
    - `data` (object, required): Resource region details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.resourceId` (string, required): Opaque stable identifier.
      - `data.page` (integer, required): One-based page number.
      - `data.bounds` (object, required): The region coordinates within the resource.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: processing, ready, failed, required): OCR and indexing state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.
  - Example request:

    ```bash
    curl --request GET '/api/v1/resource-regions/region_123' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `404 Not Found`:
      - `not_found`: The region is absent or hidden.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateResourceRegion"></a>
- **`PATCH /api/v1/resource-regions/{resourceRegionId}`**
  - Description: Updates a resource region. Changing page or bounds restarts OCR and indexing.
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
    - `resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateRegionRequest` (required).
    - `page` (integer, optional): One-based source page.
    - `bounds` (Bounds, optional): See the named shape.
      - `bounds.x` (number, required): Left coordinate in page points.
      - `bounds.y` (number, required): Top coordinate in page points.
      - `bounds.width` (number, required): Region width in page points.
      - `bounds.height` (number, required): Region height in page points.
    - `title` (string, optional): Human-readable title.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.
  - Response body:
    - `data` (object, required): Resource region details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.resourceId` (string, required): Opaque stable identifier.
      - `data.page` (integer, required): One-based page number.
      - `data.bounds` (object, required): The region coordinates within the resource.
      - `data.title` (string, required): Human-readable title.
      - `data.status` (enum: processing, ready, failed, required): OCR and indexing state.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
      - `data.extractedText` (string or null, required): OCR or extracted text when ready; null while unavailable.
  - Example request:

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

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is missing or invalid.
    - `403 Forbidden`:
      - `csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.
      - `permission_denied`: An instructor role is required.
    - `409 Conflict`:
      - `course_archived`: The course is archived.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `422 Unprocessable Content`:
      - `validation_failed`: No valid field or bounds were supplied.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteResourceRegion"></a>
- **`DELETE /api/v1/resource-regions/{resourceRegionId}`**
  - Description: Deletes a resource region. Logical deletion completes before the response; subsequent retrieval returns not_found. Search cleanup is asynchronous and the region never resurfaces.
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
    - `resourceRegionId` (string, required, 1–255 characters): Identifies the resourceRegion resource.
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
    curl --request DELETE '/api/v1/resource-regions/region_123' \
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
      - `permission_denied`: An instructor role is required.
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
