# post-folders Specification

## Purpose

Provide a staff-curated, flat organizational layer for course discussion posts while retaining independent tags, course isolation, and private-post visibility.

## Requirements

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

The course feed SHALL accept zero or more folder IDs and/or `unfiled` as repeated query values. Omitting the `folder` query SHALL show all posts; requesting `folder=unfiled` SHALL show posts without a folder. Several folder IDs SHALL match any selected folder (OR) and combine with search, tags, and other filters. Filtering SHALL occur before cursor pagination and SHALL retain private-post visibility. Selection SHALL be linkable in the URL. Invalid values SHALL fail validation; equivalent selection order SHALL not invalidate a cursor.

#### Scenario: All posts versus no folder

- **WHEN** a reader opens the course feed without a folder query, then chooses the folderless mode
- **THEN** the first feed includes all visible posts and the second includes only visible posts without a folder

#### Scenario: Multiple named folders

- **WHEN** a reader selects two named folders
- **THEN** visible posts in either selected folder appear, while other and folderless posts do not

#### Scenario: Multiple folders including Unfiled

- **WHEN** an API reader requests two folder IDs and `unfiled` as repeated query values
- **THEN** each visible post in either named folder or without a folder can appear, although the browser does not offer that combined selection

#### Scenario: Pagination remains bound to selection

- **WHEN** a member paginates a selected feed, then changes the selected folder set
- **THEN** the old cursor is rejected and cannot spill into the new feed

#### Scenario: Filter a paginated feed

- **WHEN** a member selects a folder and loads subsequent pages
- **THEN** every returned post belongs to that folder, with no repeats, hidden posts, or unfiltered cursor spillover

#### Scenario: Folder deletion

- **WHEN** staff delete a selected folder
- **THEN** its posts lose that folder and the selected filter drops the deleted folder; if none remain, the reader sees folderless posts

#### Scenario: Unfiled and deleted folders

- **WHEN** an API reader requests `folder=unfiled` after staff delete a folder
- **THEN** the former folder's posts appear if otherwise visible to that reader

### Requirement: Browser controls are accessible

The discussion UI SHALL provide an accessible, separate All posts control and a group of staff-created folder checkboxes in the left sidebar. All posts SHALL be the initial course feed mode. Choosing it SHALL clear named folder selections; choosing a named folder SHALL clear All posts. Zero selected controls SHALL show only folderless posts. The folder UI SHALL not display “Unfiled”; it SHALL use “No folder” only for a missing-folder choice in create/edit pickers or filter mode. Folderless posts SHALL omit folder text on feed cards and detail pages. Accessible create/edit folder pickers and staff-only management controls remain.

#### Scenario: Switch between all, named, and folderless posts

- **WHEN** a reader opens the course feed, selects two folders, then unchecks both and finally chooses All posts
- **THEN** the sidebar and shareable URL represent each mode, with no page reload or ambiguous checked state

#### Scenario: Multi-select sidebar

- **WHEN** a reader checks and unchecks several named folders
- **THEN** the feed and URL reflect their OR selection, and clearing the last folder shows only folderless posts

#### Scenario: Legacy mixed folder link

- **WHEN** a reader opens a link containing named folders and `folder=unfiled`
- **THEN** the browser retains only the named-folder selection, since the sidebar cannot represent that combination

#### Scenario: Member organizes a post

- **WHEN** a member creates or edits a post with a folder using keyboard controls
- **THEN** the selected folder is submitted and reflected in feed and detail; the empty choice is labeled “No folder”

#### Scenario: Staff rename and delete

- **WHEN** staff rename or delete a folder from management controls
- **THEN** the choices and affected post labels update without a page reload
