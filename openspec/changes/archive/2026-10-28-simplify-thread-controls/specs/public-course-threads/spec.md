## ADDED Requirements

### Requirement: Threads browser attachment visibility

The Threads browser UI SHALL NOT offer an attachment picker for now. It SHALL continue to display links for previously uploaded attachments. The API attachment contract remains unchanged.

#### Scenario: Existing attachment remains available

- **WHEN** an authorized member opens a Threads message with an existing attachment
- **THEN** the attachment download link is visible, but no Attach file control is offered

### Requirement: Threads controls match course buttons

Threads action buttons SHALL retain the shared primary, secondary, and danger styling, including visible keyboard focus, but SHALL use approximately 20% smaller dimensions than their current enlarged Threads-specific size. Buttons elsewhere in the application SHALL not change.

#### Scenario: Threads actions are compact

- **WHEN** a member opens the Threads board and conversation views
- **THEN** action buttons in both views use the reduced dimensions without losing their distinct styling or focus indication

## MODIFIED Requirements

### Requirement: Attachments obey message and membership access

An authorized message editor SHALL be able to upload a validated document or image through the API after the message has been saved. Upload failure SHALL not erase the saved message. Every metadata read and download SHALL require current course membership and an active, visible parent message. Removing a message or board SHALL immediately deny its file downloads and enqueue byte cleanup. Archived courses SHALL allow authorized downloads but no new upload or removal. The API SHALL deduplicate an upload retry with the same idempotency key and payload.

#### Scenario: Former member requests a file

- **WHEN** a user who left the course requests a Thread message attachment
- **THEN** the system denies access without disclosing file bytes or metadata

#### Scenario: Upload fails after message save

- **WHEN** object storage rejects an attachment upload after a reply is saved
- **THEN** the reply remains visible and the file can be retried independently through the API

#### Scenario: Attachment response is lost

- **WHEN** an API client retries the same file and idempotency key after its upload response was lost
- **THEN** the retry does not create a duplicate attachment
