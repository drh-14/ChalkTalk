## MODIFIED Requirements

### Requirement: Question detail presents question-level followup discussions

The question detail SHALL show a root followup count and a prominent zero-followup compose prompt. Members SHALL create roots and nested replies using the shared Markdown/LaTeX composer and optional anonymity. The page SHALL list roots and direct replies with cursor-based loading, render bodyless deleted parent tombstones when children remain, and show vote controls beneath active followup content. Author and staff edit/delete controls SHALL follow server-projected `canEdit`; other members SHALL not see them. Existing root and reply bodies SHALL be edited only through the version-checked REST composer. Failed REST writes and version conflicts SHALL preserve draft text and offer explicit refresh. Saved root and reply content SHALL render Markdown and LaTeX immediately after creation or editing and SHALL support separately uploaded parent-scoped attachments with centered images and document links. Attachment controls SHALL honor current parent edit rights and active-course status; partial upload failures SHALL preserve committed text and retryable file selections.

#### Scenario: Empty followups

- **WHEN** a member opens a question with no followup roots
- **THEN** a zero count and prominent compose prompt are displayed

#### Scenario: Nested followup and tombstone

- **WHEN** a member opens a deleted parent with visible replies
- **THEN** the bodyless tombstone and nested replies remain navigable

#### Scenario: Followup vote and pagination

- **WHEN** a member votes on a followup and loads the next root page
- **THEN** the vote count updates beneath that followup and additional roots append without duplicate entries
