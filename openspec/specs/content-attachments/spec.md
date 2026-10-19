# content-attachments Specification

## Purpose

Allow course members to include validated images and documents in existing post, answer, and followup bodies without weakening course or parent permissions.

## Requirements

### Requirement: Parent-scoped attachment creation

The API SHALL accept a new multipart file for a visible question or note, a visible shared answer, or a visible question-level followup or reply. It SHALL NOT attach an existing standalone course file. A caller SHALL have current course membership, an active course, and the existing permission to edit that parent. Each parent SHALL have at most five active attachments, each at most 100 MiB. Allowed formats SHALL be the eight validated course-file formats: PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX, and PPTX. The API SHALL reject missing, malformed, disguised, executable, macro-capable, and unsupported content using the same validation as course files. A matching idempotency key and identical bytes SHALL replay the original creation, including after course archival while the caller remains authorized; conflicting reuse SHALL fail without creating another attachment. Attachment metadata SHALL not reveal the uploader's identity.

#### Scenario: Member adds an image to an editable post

- **WHEN** a member uploads a valid PNG to their active question with room for another file
- **THEN** the API creates one attachment and subsequent post reads include its ID, name, media type, size, and download endpoint

#### Scenario: Sixth attachment is rejected

- **WHEN** five active attachments exist on a parent and an editor uploads another file
- **THEN** the API rejects the upload without storing another live attachment

#### Scenario: Parent role denies upload

- **WHEN** a student uploads to an instructor-floor staff answer
- **THEN** the API denies the operation and changes neither parent nor storage

#### Scenario: Upload replay is exact

- **WHEN** the same editor retries the same parent upload with the same key and bytes
- **THEN** the original attachment is returned without adding another object

### Requirement: Private attachment read and presentation

The API SHALL stream the original bytes only to current members who can see the attachment's parent. Downloads SHALL be authenticated, non-cacheable, and `nosniff`. Safe validated images SHALL use inline disposition; documents SHALL use attachment disposition. Parent reads SHALL expose active attachment metadata without uploader identity or public storage URLs. The UI SHALL show images as centered blocks beneath text and documents as clickable attachment links; it SHALL use authenticated API access and not embed remote object-store URLs.

#### Scenario: Member views a post image

- **WHEN** a current course member views a visible post with a PNG attachment
- **THEN** the image appears centered beneath the text and its original bytes load through the authenticated API

#### Scenario: Nonmember download is hidden

- **WHEN** a nonmember knows an attachment ID
- **THEN** the API returns the same not-found result as for an absent attachment

### Requirement: Attachment deletion and parent lifecycle

An attachment editor SHALL be able to remove an attachment under the same authorization as editing its parent. Removal SHALL immediately hide metadata and deny downloads and SHALL enqueue durable asynchronous deletion of object bytes. Deleting a parent SHALL hide its attachments and queue byte cleanup. A confirmed duplicate source SHALL hide its attachments without moving or deleting them; unmerging SHALL restore them. A deleted followup tombstone SHALL not expose attachments. A course deletion SHALL clean attachment bytes. Archived courses SHALL allow authorized reads but not attachment mutations.

#### Scenario: Duplicate source is unmerged

- **WHEN** staff confirm a post as duplicate and later unmerge it
- **THEN** its previously attached files are hidden while merged and visible again after unmerge

#### Scenario: Attachment removed

- **WHEN** an authorized editor removes an attachment
- **THEN** reads immediately omit it and a worker can eventually delete its object bytes

### Requirement: Shared answer attachment changes invalidate current endorsement

Adding or removing a shared-answer attachment SHALL clear its current endorsement, advance its version and modification time, record the authorized editor in the existing contributor history (subject to anonymous identity rules), and retain its historical endorsement event. It SHALL preserve the answer's Markdown text and leave later save-only text corrections possible without any answer-specific CRDT storage.

#### Scenario: Endorsed answer gains a document

- **WHEN** an authorized editor adds a DOCX to an endorsed answer
- **THEN** the document appears, the current endorsement clears, and the earlier endorsement event remains available to historical statistics

### Requirement: Composer uploads recover independently

The composer SHALL create the parent text before uploading selected attachments sequentially with independent idempotency keys. If one upload fails, it SHALL retain the created text and other successful attachments and offer retry for only the failed file. It SHALL not silently duplicate a file on retry.

#### Scenario: One selected file fails

- **WHEN** a member creates a question with two selected files and the second upload fails
- **THEN** the question and first attachment remain, and the second file can be retried without recreating the question

### Requirement: Attachment HTTP contract

`POST /api/v1/posts/{postId}/attachments`, `POST /api/v1/answers/{answerId}/attachments`, and `POST /api/v1/followups/{followupId}/attachments` SHALL accept one multipart `file` after standard authenticated Origin and CSRF checks. Success SHALL return `201`, a `Location` pointing to the authenticated download endpoint, and a `data` object containing only `id`, `fileName`, `mediaType`, `sizeBytes`, `createdAt`, and `downloadUrl`. Invalid/missing multipart fields or an invalid idempotency key SHALL return `422`; invalid or unsupported file content `415`; per-file or parent-count limit violations `413`; conflicting idempotency reuse `409`; insufficient parent edit rights `403`; hidden/nonmember parent `404`; and a new mutation on an archived course `409`.

`GET /api/v1/attachments/{attachmentId}/download` SHALL require authentication and current parent visibility and return original bytes. `DELETE /api/v1/attachments/{attachmentId}` SHALL apply parent edit/active-course checks and return `204`, immediately hide that attachment, and enqueue asynchronous byte cleanup. A removed or hidden attachment SHALL return `404` on download or later deletion. Parent metadata SHALL be refreshed after successful mutations without dropping queued failed files.

#### Scenario: A post keeps a partially failed upload queue

- **WHEN** the first selected file succeeds, a parent refresh is delayed, and a later file upload fails
- **THEN** the first attachment and saved post remain visible and the later file retains its retry state and original idempotency key

#### Scenario: Sibling attachment mutations overlap

- **WHEN** authorized members upload files to different answers or followups under the same question concurrently
- **THEN** both successful uploads SHALL remain attached without a lock-upgrade deadlock losing an otherwise valid operation
