# organized-course-resources Specification

## Purpose
Define instructor-created resource sections, managed file and link entries, and current-membership-based visibility for course resources.

## Requirements

### Requirement: Sections are explicitly instructor created

The course SHALL start with zero sections. Only current same-course instructors SHALL create/name/reorder/edit/delete sections in active courses. Existing flat resources SHALL remain ungrouped until moved by an instructor; no automatic stored section SHALL be introduced. Removing a section SHALL retain its resources ungrouped without widening effective staff-only access.
Migrated files with awkward legacy names SHALL receive a trimmed, bounded, nonblank catalog display title using the same boundary whitespace semantics as JavaScript String.trim, with a safe fallback if the name is blank after trimming, while preserving the stored filename and bytes unchanged.

#### Scenario: Course has existing flat resources

- **WHEN** the catalog migration runs
- **THEN** live files and links remain readable in an ungrouped list and zero sections are created

#### Scenario: A legacy filename does not fit a display title

- **WHEN** the catalog migration encounters a live file whose name has leading spaces or trims to blank
- **THEN** the file remains in the catalog with a nonblank title of at most 200 characters and its original filename and bytes are unchanged

### Requirement: Catalog visibility is authoritative

Every listing, metadata read and original-byte download, including legacy file URLs, SHALL verify current authenticated membership in the actual persisted resource course. Staff-only sections SHALL restrict all contained items; item restrictions MAY narrow class-visible sections. Only current same-course TA/instructor roles SHALL read staff-only data. Hidden reads SHALL be404 and filtering SHALL occur before counts/pagination. Archived authorized reads SHALL remain available.

#### Scenario: Student uses a staff resource file URL

- **WHEN** the student requests a staff-only file directly, including its old file URL
- **THEN** the API returns404 without fetching object bytes or exposing metadata

#### Scenario: Staff belongs only to another course

- **WHEN** that staff user requests the resource
- **THEN** the API returns404

### Requirement: Instructors manage stable catalog resources

Active-course instructors SHALL rename, move, reorder, replace and remove any catalog resource independently of standalone upload ownership. Conditional metadata writes SHALL reject missing/stale If-Match with428/412. Replacement SHALL retain stable resource identity while atomically selecting a validated immutable file or link revision. Storage or conditional failure SHALL retain the current revision. Logical deletion SHALL hide content immediately and queue unreferenced bytes for worker cleanup.
For file replacement, each omitted title, section or visibility field SHALL retain its value from the current locked resource; only explicitly supplied metadata SHALL change. New resource creation retains its filename/class/ungrouped defaults.
After archival, an identical replay of a previously successful catalog create or file replacement MAY return its original success response without a new write, but only for a current authenticated same-course instructor with the matching request and unexpired key. Fresh or changed archived writes SHALL return 409.

#### Scenario: Another instructor replaces a resource

- **WHEN** a current instructor conditionally replaces a file uploaded by another instructor
- **THEN** the resource ID is unchanged, the new revision is current, and the old file URL is hidden before cleanup

#### Scenario: An instructor replaces only the bytes of a staff file

- **WHEN** a current instructor replaces a staff-only file without title, section or visibility fields
- **THEN** its title, section and effective staff-only access remain unchanged through catalog and legacy file URLs

#### Scenario: An archived instructor retries a catalog upload

- **WHEN** the current same-course instructor repeats a successful catalog upload with its original unexpired key and identical metadata and bytes after archival
- **THEN** the original success response is returned without a new revision; a changed request or fresh key returns 409

### Requirement: Browsers show organized resources

Members SHALL see file/title-click download links and named external links grouped under instructor-created headings, excluding hidden sections/items. Instructors SHALL have accessible creation, rename, visibility, move, replacement/removal and ordering controls. Title/date sorting SHALL preserve manual order. Stale/error actions SHALL retain recoverable input and responsive mobile layouts.

#### Scenario: No sections exist

- **WHEN** an instructor opens resources
- **THEN** creation is offered without displaying preset section names
