## MODIFIED Requirements

### Requirement: Members create question-level followups

`POST /api/v1/posts/{postId}/followups` SHALL create a direct followup on a visible question, and `POST /api/v1/followups/{parentId}/replies` SHALL create a reply under a followup of the same question. Current members of active courses SHALL provide JSON `bodyMarkdown` of 1–100,000 non-whitespace characters and optional boolean `anonymous`; attachments SHALL be uploaded separately after the text parent is created. Creation SHALL return `201`, Location, ETag and version 1, with idempotent retry semantics. A note SHALL return `409 not_a_question`; hidden/cross-course/nonmember content `404`; inactive course `409`.

#### Scenario: Start discussion before an answer exists

- **WHEN** a member creates a direct followup on a question with zero answers
- **THEN** the followup is created and appears in that question's root list

#### Scenario: Reply to another question is rejected

- **WHEN** a reply target does not belong to the visible question context
- **THEN** the operation fails without creating a row
