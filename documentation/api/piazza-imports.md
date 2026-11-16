# Piazza JSON imports

`POST /api/v1/piazza-imports` imports a JSON file previously saved by ChalkTalk's Piazza CLI (`--save`). Native Piazza ZIP/CSV/instructor exports are not accepted. The browser never sends Piazza credentials. The uploader must have the necessary authorization to migrate the content; ChalkTalk session permission does not establish rights to copy Piazza data.

## Request

Authenticated multipart/form-data with exactly one `file` field, a valid `Origin`, the session cookie, and `X-CSRF-Token`. The owner is the authenticated session user; the request cannot nominate another owner or destination course. The file is capped at 20 MiB. The API validates the known CLI `PiazzaExport` structure and bounded collections before writing, and deletes the temporary upload on every outcome.

The UI preview is informational only. The server omits all `status: "private"` posts and their descendants, as well as historical people not referenced by retained content. The CLI import itself retains its existing behavior. Historical author accounts use synthetic `.piazza.invalid` addresses and undisclosed credentials; the response does not expose them.

## Success

`200 OK`, `Location: /api/v1/courses/{courseId}`, `Content-Type: application/json`:

```json
{
  "data": {
    "courseId": "00000000-0000-5000-8000-000000000000",
    "courseName": "CSE 416 Software Engineering",
    "omittedPrivatePosts": 1,
    "posts": { "created": 3, "updated": 0, "skipped": 0 },
    "answers": { "created": 2, "updated": 0, "skipped": 0 },
    "followups": { "created": 3, "updated": 0, "skipped": 0 }
  }
}
```

An initial import creates a course owned by the uploader. A re-import updates the same deterministic course, without duplicating retained content, only if the uploader is a current instructor of that course in the same organization. The check is made inside the locked transaction before any enrollment or content changes. A re-import omitting private content does not delete private posts imported earlier by the CLI.

## Errors

See the [OpenAPI operation](../openapi.yaml) for response status and error schemas. An oversized file must be imported through the CLI; invalid multipart fields or counts and incompatible JSON are rejected before import. A user without current instructor access to an existing import cannot update it.

A validation or database error does not create a partial course. The uploaded source is never retained in S3 or the database and its content is not logged.
