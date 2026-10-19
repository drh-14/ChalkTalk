## ADDED Requirements

### Requirement: Authorized members edit posts explicitly
The post detail SHALL provide Edit to the author or course TA/instructor only while the course is active and the visible post is not a confirmed duplicate. Anonymous display identity SHALL NOT grant ownership. Editing SHALL preserve immutable post type and use the existing title, Markdown/LaTeX, tags and anonymity authoring controls. Text changes SHALL stay local until Save. Cancel SHALL return to view without committing unsaved text. Existing Pin and Merge controls SHALL remain unchanged. A merge SHALL ask before discarding a dirty edit, retain the editor and failed-file queue if the merge fails, and prevent editing while the merge is pending. Edit buttons for posts, answers, root followups and replies SHALL use slightly increased padding and corner radius without changing their existing colors.

#### Scenario: Author edits a question or note
- **WHEN** an authorized member selects Edit, changes the draft and saves
- **THEN** a version-checked update persists the changes and returns to rendered view

#### Scenario: Read-only member views a post
- **WHEN** a different student or a member of an archived course views the post
- **THEN** no Edit or post file mutation controls appear, while existing images and document links remain readable

#### Scenario: Cancel or save failure preserves the correct text
- **WHEN** an editor cancels an unsaved draft or Save fails validation or network checks
- **THEN** Cancel leaves persisted text unchanged and a failed Save retains the draft for correction or retry

#### Scenario: Stale draft needs explicit review
- **WHEN** Save receives a version conflict
- **THEN** the draft remains intact and the editor can load the latest post for review before explicitly retrying

### Requirement: Post file controls belong to authoring
Post view SHALL show only existing images and document links without upload, selection or removal controls. Create and Edit SHALL provide the existing five-file, 100 MiB, eight-format selection and independent upload behavior. Save SHALL persist text before new file uploads. Failed files SHALL remain retryable with stable keys without resaving text or recreating posts. Successful attachment mutations SHALL refresh the parent revision without replacing locally typed text or unmounting failed-file queues. A refreshed revision MAY include concurrent remote text changes; the editor SHALL retain its local draft and MAY overwrite that remote text only on the next explicit Save using the refreshed If-Match version, without requiring Review latest post first. A further version conflict SHALL still require explicit review. Cancel SHALL not undo already persisted independent file mutations.

#### Scenario: Editor retries a partial upload
- **WHEN** text saves and one selected file succeeds while another fails
- **THEN** saved text and successful attachments remain, and retry uploads only the failed file using its original key

#### Scenario: File mutation refreshes an active draft
- **WHEN** a file mutation refreshes the post revision and learns concurrent remote text changes while the editor has unsaved text
- **THEN** the local draft survives without a text PATCH until Save, and the next explicit Save uses the refreshed revision to replace the remote text

### Requirement: Response file controls belong to authoring
Both shared answer slots, root followups and nested replies SHALL show existing images and document links in view without file selection, upload or removal controls. Authorized Edit SHALL expose those controls using existing permission and active-course rules, while existing create composers retain uploads. Attachment queues SHALL stay mounted across text editing and partial file failures.

#### Scenario: Edit an answer or followup attachment
- **WHEN** an authorized member views an existing answer, root followup or reply and then selects Edit
- **THEN** file mutation controls are absent in view and available in Edit, with existing attachments readable throughout

#### Scenario: Read-only response attachment
- **WHEN** an unauthorized member or a member of an archived course views an answer, followup or reply
- **THEN** existing attachments remain readable without Edit or file mutation controls
