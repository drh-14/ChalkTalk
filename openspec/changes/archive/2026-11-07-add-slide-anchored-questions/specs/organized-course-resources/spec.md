## MODIFIED Requirements

### Requirement: Browsers show organized resources

Members SHALL see file and link entries grouped under instructor-created headings, excluding hidden sections and items. Selecting the title of an upload whose current file is a PDF SHALL open the in-app PDF viewer for that resource. Selecting the title of any other upload SHALL download it, and named external links SHALL open in a new tab. Each PDF entry SHALL also offer a Download action for the original file. Instructors SHALL have accessible creation, rename, visibility, move, replacement/removal and ordering controls. Title/date sorting SHALL preserve manual order. Stale/error actions SHALL retain recoverable input and responsive mobile layouts.

#### Scenario: No sections exist

- **WHEN** an instructor opens resources
- **THEN** creation is offered without displaying preset section names

#### Scenario: A member opens lecture slides

- **WHEN** a member selects the title of a PDF resource
- **THEN** the in-app viewer opens for that resource, and the entry's Download action still downloads the original file

#### Scenario: A member opens a Word document

- **WHEN** a member selects the title of a DOCX resource
- **THEN** the original file downloads as before
