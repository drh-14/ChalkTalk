## Organizations

<a id="listOrganizations"></a>
- **`GET /api/v1/organizations`**
  - Description: Lists the organizations that contain the authenticated user.
  - Authentication: `Cookie: __Host-chalktalk_session=<opaque-session>`.
  - Access: Signed-in user; returns only organizations available to the caller.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.
  - Path parameters:
    - None.
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
    - `data` (list of objects, required): Organizations returned by this request.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.name` (string, required): Human-readable title.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
    - `page` (object, required): Pagination details for the current result set.
  - Example request:

    ```bash
    curl --request GET '/api/v1/organizations' \
        --header 'Accept: application/json' \
        --header 'Cookie: __Host-chalktalk_session=opaque_session'
    ```

  - Example success response:

    ```json
    {
      "data": [
        {
          "id": "org_123",
          "name": "Example University",
          "createdAt": "2026-01-01T00:00:00Z",
          "updatedAt": "2026-09-01T00:00:00Z",
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
      - `invalid_request`: Pagination is invalid.
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
