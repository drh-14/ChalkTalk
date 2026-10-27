## Purpose

Provide a staff-curated, flat organizational layer for course discussion posts while retaining independent tags, course isolation, and private-post visibility.

## ADDED Requirements

### Requirement: Staff manage a course's folder definitions

Course staff SHALL create, rename, list, and delete folders for their active course. Names SHALL be trimmed, nonempty, at most 64 Unicode code points, and unique within a course ignoring case. The list SHALL be alphabetical ignoring case. Members SHALL read the list; nonmembers SHALL receive `404 not_found`; students SHALL not mutate it. Referencing a missing or other-course folder SHALL fail without creating or moving a post. Deletion SHALL atomically leave associated posts Unfiled.

#### Scenario: Staff manage folders

- **WHEN** staff create, rename, or delete a valid folder
- **THEN** members see the changed alphabetic list, and deletion makes its posts Unfiled

#### Scenario: Duplicate or unauthorized mutation

- **WHEN** a student tries to mutate folders, or staff use an invalid or case-insensitively duplicate name
- **THEN** the request fails without changing folders

### Requirement: Each post has at most one optional folder

Posts SHALL default to Unfiled. Authors and staff SHALL assign an existing folder in the same course to an editable post, or clear its assignment. Post create, get, update, and list responses SHALL include the folder's ID and current name or `null`. Folder assignment SHALL not change tags. Existing conditional edit and private-post permissions SHALL apply.

#### Scenario: Author files and clears a post

- **WHEN** an author creates or edits a post with a valid course folder, then clears it
- **THEN** the response first identifies that folder and then reports `null`, with unchanged tags

#### Scenario: Invalid folder assignment

- **WHEN** a user references a folder from another course or a deleted folder
- **THEN** creation or update fails atomically without exposing another course's folder

### Requirement: Feed folder filtering preserves visibility and pagination

The course feed SHALL accept one folder ID or an explicit Unfiled filter, combinable with existing search, tags, and sort. Filtering SHALL occur before cursor pagination and SHALL retain the existing private-post and anonymous-identity visibility constraints. Folder selection SHALL be linkable in the URL.

#### Scenario: Filter a paginated feed

- **WHEN** a member selects a folder and loads subsequent pages
- **THEN** every returned post belongs to that folder, with no repeats, hidden posts, or unfiltered cursor spillover

#### Scenario: Unfiled and deleted folders

- **WHEN** a reader chooses Unfiled after staff delete a folder
- **THEN** the former folder's posts appear if otherwise visible to that reader

### Requirement: Browser controls are accessible

The discussion UI SHALL provide an accessible folder filter, a new-post folder picker, an editor folder picker, and staff-only management controls. Feed and detail folder labels SHALL show only the folder name, or `Unfiled` when none is assigned, without a `Folder:` prefix. Empty and error states SHALL be understandable, and the narrow layout SHALL remain usable.

#### Scenario: Member organizes a post

- **WHEN** a member creates or edits a post with a folder using keyboard controls
- **THEN** the selected folder is submitted and reflected in feed and detail

#### Scenario: Staff rename and delete

- **WHEN** staff rename or delete a folder from management controls
- **THEN** the choices and affected post labels update without a page reload
