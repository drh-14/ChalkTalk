## MODIFIED Requirements

### Requirement: Public collaborative editing and attachments remain unavailable

`PATCH /api/v1/answers/{answerId}`, answer collaboration connection tickets, answer followup routes, and multipart answer requests SHALL not be live. Their routes SHALL not be registered, and a multipart create request SHALL return `422 validation_failed`. Public clients SHALL have no way to edit answer text after creation; the private answer document core MAY persist Yjs updates and project their text to the existing answer read API. `documentation/api/answers.md` SHALL carry an implementation-status note naming what is live and what remains the target contract, while the target definitions are kept.

#### Scenario: A client tries to edit an answer

- **WHEN** a client sends `PATCH /api/v1/answers/{answerId}`
- **THEN** the route is unavailable and the answer is unchanged
