# course-resource-links Specification

## Purpose
Specify safe named external links in the organized course resource catalog.

## Requirements

### Requirement: Instructor-created named external links

The API SHALL accept a named link with `{kind:"link",title,url}` and optional catalog metadata on `POST /api/v1/courses/{courseId}/resources` only from authenticated current instructors of an active course with valid Origin and CSRF. Title SHALL be trimmed, nonblank and no more than 200 Unicode code points. URL SHALL be absolute HTTP(S), no more than 2048 Unicode code points, with a hostname and without credentials, raw Unicode whitespace (including surrounding whitespace), C0/C1 controls or backslashes; percent-encoded bytes and ordinary non-ASCII path characters SHALL remain valid. The server SHALL NOT fetch link targets. Success SHALL return201, a collection Location and catalog metadata as specified in organized-course-resources. Invalid bodies SHALL return422, non-JSON media422, unauthenticated401, noninstructors403 and new archived/deleting writes409. A valid optional Idempotency-Key SHALL bind creator/course/input for24hours transactionally; exact currently-authorized instructor retries while visible SHALL replay201 without duplication including after archival and changed input SHALL return409.

#### Scenario: Instructor adds and retries a link
- **WHEN** an active-course instructor posts a valid named HTTP(S) link and retries identical input with the same key
- **THEN** both responses identify one persisted link; changed input with that key returns409

#### Scenario: Invalid or unauthorized creation
- **WHEN** an invalid URL/title/body, a noninstructor, unauthenticated caller or archived-course new write attempts creation
- **THEN** the request is rejected without creating a link

### Requirement: Unified member resource listing

`GET /api/v1/courses/{courseId}/resources` SHALL return catalog entries to current members of active/archived courses under the visibility, sorting and pagination contract in organized-course-resources. Deleted entries, other courses and missing/deleting/inaccessible courses SHALL be hidden. The response SHALL use private,no-store caching. Pagination SHALL default25 and accept limit1–100 with strict single cursor/limit query fields. Invalid/foreign/repeated query values SHALL return400.

#### Scenario: Mixed deterministic pagination
- **WHEN** a member pages mixed files and links
- **THEN** both kinds are returned exactly once in the selected deterministic order

#### Scenario: Isolation and readonly access
- **WHEN** a current member reads an archived course
- **THEN** the mixed list is readable, but deleted files and other courses are excluded and outsiders/deleting courses receive404

### Requirement: Files and links interface

The Resources interface SHALL group files and links under instructor-created sections as specified in organized-course-resources. File titles themselves SHALL link to authenticated downloads with no separate Download text/button. External link titles SHALL open target_blank with rel noopener noreferrer and an accessible new-tab indication. Only current active-course instructors SHALL see upload and add-link controls. The add-link form SHALL retain a stable key for identical retry, reset its key for changed input, show progress/error/success, guard duplicate submissions and preserve existing entries on failure. Mobile wrapping and keyboard interaction SHALL remain accessible.

#### Scenario: Instructor adds a named link
- **WHEN** an instructor submits a link, encounters a transient error and retries unchanged input
- **THEN** the existing list remains, the same key is reused and success refreshes the mixed list

#### Scenario: Member activates an entry
- **WHEN** a member activates a filename or named external link
- **THEN** the filename downloads original bytes and the link opens its URL safely in a new tab

### Requirement: Consistent Resources action button shape and spacing
Course Resources Upload file, Add link, Try again and Load more buttons SHALL use radius-lg (0.85rem), vertical space-3 (0.75rem) and horizontal space-5 (1.25rem) at desktop and mobile sizes. Existing primary/secondary colors, minimum height, focus behavior and action semantics SHALL remain unchanged. Filename downloads and named external links SHALL remain links without separate Download buttons. The native Browse/Choose File button SHALL match Add link primary background, foreground, border, font, radius, padding, minimum height and hover/focus/disabled feedback. The accessible labeled real file input, click and keyboard picker behavior, accept filter and disabled state SHALL remain unchanged.

#### Scenario: Desktop and mobile action controls
- **WHEN** an instructor views Resources and retries a failed list request or loads another page at desktop or mobile width
- **THEN** all visible action buttons have the specified corners and padding with their existing colors and no horizontal page overflow

#### Scenario: Native file picker at desktop and mobile sizes
- **WHEN** an instructor clicks or uses the keyboard to activate the labeled course-file input
- **THEN** the native chooser opens, selecting a supported file enables upload, the native button matches Add link visual treatment in normal, hover, keyboard-focus and disabled states, and the page has no horizontal overflow

### Requirement: Resource chooser separates adjacent filename text
The Resources native Choose File button SHALL have a 4.4px margin-inline-end before adjacent filename or No file chosen text, approximately 10% above the measured 4px baseline. Existing primary button styling, padding, native chooser accessibility and upload behavior SHALL remain unchanged.

#### Scenario: Empty selection and long filename
- **WHEN** an instructor views the Resources chooser before selection or after selecting a long supported filename at desktop or mobile width
- **THEN** the margin is 4.4px and the page has no horizontal overflow

### Requirement: Organized catalog integration

Named links SHALL be managed catalog entries with section/visibility/version metadata while retaining safe HTTP(S), Unicode title limits and authorized idempotent creation.
Successful link creation and unexpired pre-migration replays SHALL return the current catalog response shape and an ETag for the returned version, including links whose legacy ID collided with a file ID.
An identical replay of a previously successful link creation MAY return the original success response after archival without creating another link. This exception SHALL still require the current authenticated same-course instructor, matching request hash and an unexpired key; a fresh archived creation SHALL return 409.

#### Scenario: A catalog item is restricted

- **WHEN** an unauthorized member requests the item through an existing endpoint
- **THEN** the endpoint does not disclose the item

#### Scenario: An archived instructor retries an existing link

- **WHEN** the current same-course instructor repeats a successful link creation with its original unexpired key and identical request after archival
- **THEN** the original success response is returned without a new link write; a changed request or fresh key returns 409
