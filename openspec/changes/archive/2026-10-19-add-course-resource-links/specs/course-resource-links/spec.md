## ADDED Requirements

### Requirement: Instructor-created named external links

The API SHALL accept exactly `{kind:"link",title,url}` on `POST /api/v1/courses/{courseId}/resources` only from authenticated current instructors of an active course with valid Origin and CSRF. Title SHALL be trimmed, nonblank and no more than 200 Unicode code points. URL SHALL be absolute HTTP(S), no more than 2048 Unicode code points, with a hostname and without credentials, raw Unicode whitespace (including surrounding whitespace), C0/C1 controls or backslashes; percent-encoded bytes and ordinary non-ASCII path characters SHALL remain valid. The server SHALL NOT fetch link targets. Success SHALL return201, a collection Location and `{data:{kind:"link",id,courseId,title,url,createdAt}}` without creator identity. Invalid bodies SHALL return422, non-JSON media422, unauthenticated401, noninstructors403 and new archived/deleting writes409. A valid optional Idempotency-Key SHALL bind creator/course/input for24hours transactionally; exact currently-authorized instructor retries while visible SHALL replay201 without duplication including after archival and changed input SHALL return409.

#### Scenario: Instructor adds and retries a link
- **WHEN** an active-course instructor posts a valid named HTTP(S) link and retries identical input with the same key
- **THEN** both responses identify one persisted link; changed input with that key returns409

#### Scenario: Invalid or unauthorized creation
- **WHEN** an invalid URL/title/body, a noninstructor, unauthenticated caller or archived-course new write attempts creation
- **THEN** the request is rejected without creating a link

### Requirement: Unified member resource listing

`GET /api/v1/courses/{courseId}/resources` SHALL return one flat `data` array with `page:{hasMore,nextCursor}` to current members of active/archived courses. Live actual course_files SHALL retain existing public metadata plus kind:"upload"; named links SHALL expose kind:"link",id,courseId,title,url,createdAt only. Deleted files, other courses and missing/deleting/inaccessible courses SHALL be hidden. The response SHALL use private,no-store caching. Pagination SHALL default25 and accept limit1–100 with strict single cursor/limit query fields. Ordering SHALL be exact created_at DESC,id DESC,kind DESC; opaque cursors SHALL preserve PostgreSQL microseconds and bind endpoint and course. Invalid/foreign/repeated query values SHALL return400.

#### Scenario: Mixed deterministic pagination
- **WHEN** a member pages mixed files and links, including equal IDs and timestamps
- **THEN** both kinds are returned exactly once in deterministic order without truncating timestamp precision

#### Scenario: Isolation and readonly access
- **WHEN** a current member reads an archived course
- **THEN** the mixed list is readable, but deleted files and other courses are excluded and outsiders/deleting courses receive404

### Requirement: Flat files and links interface

The Resources interface SHALL show one flat mixed list without categories or sections. File names themselves SHALL link to authenticated downloads with no separate Download text/button. External link titles SHALL open target_blank with rel noopener noreferrer and an accessible new-tab indication. Only current active-course instructors SHALL see upload and add-link controls. The add-link form SHALL retain a stable key for identical retry, reset its key for changed input, show progress/error/success, guard duplicate submissions and preserve existing entries on failure. React identities SHALL distinguish kind and ID. Mobile wrapping and keyboard interaction SHALL remain accessible.

#### Scenario: Instructor adds a named link
- **WHEN** an instructor submits a link, encounters a transient error and retries unchanged input
- **THEN** the existing list remains, the same key is reused and success refreshes the mixed list

#### Scenario: Member activates an entry
- **WHEN** a member activates a filename or named external link
- **THEN** the filename downloads original bytes and the link opens its URL safely in a new tab
