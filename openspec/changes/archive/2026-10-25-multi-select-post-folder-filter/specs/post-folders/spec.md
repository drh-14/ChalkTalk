## MODIFIED Requirements

### Requirement: Feed folder filtering preserves visibility and pagination

The course feed SHALL accept zero or more folder IDs and/or `unfiled` as repeated query values. No selection SHALL show all posts. Several selections SHALL match any selected folder (OR), including Unfiled, and combine with search, tags, and other filters. Filtering SHALL occur before cursor pagination and SHALL retain private-post visibility. Selection SHALL be linkable in the URL. Invalid values SHALL fail validation; equivalent selection order SHALL not invalidate a cursor.

#### Scenario: Multiple folders including Unfiled

- **WHEN** a member selects two folders and Unfiled
- **THEN** each visible post in any of those three locations can appear, while other folders and hidden posts do not

#### Scenario: Pagination remains bound to selection

- **WHEN** a member paginates a selected feed, then changes the selected folder set
- **THEN** the old cursor is rejected and cannot spill into the new feed

#### Scenario: Filter a paginated feed

- **WHEN** a member selects a folder and loads subsequent pages
- **THEN** every returned post belongs to that folder, with no repeats, hidden posts, or unfiltered cursor spillover

#### Scenario: Unfiled and deleted folders

- **WHEN** a reader chooses Unfiled after staff delete a folder
- **THEN** the former folder's posts appear if otherwise visible to that reader

### Requirement: Browser controls are accessible

The discussion UI SHALL provide an accessible group of folder checkboxes in the left sidebar, including Unfiled. Multiple checked folders SHALL be permitted and zero checked folders SHALL mean all. Existing accessible assignment and management controls remain.

#### Scenario: Multi-select sidebar

- **WHEN** a reader checks and unchecks folders, including Unfiled
- **THEN** the feed and shareable URL reflect the selected set without requiring a page reload

#### Scenario: Member organizes a post

- **WHEN** a member creates or edits a post with a folder using keyboard controls
- **THEN** the selected folder is submitted and reflected in feed and detail

#### Scenario: Staff rename and delete

- **WHEN** staff rename or delete a folder from management controls
- **THEN** the choices and affected post labels update without a page reload
