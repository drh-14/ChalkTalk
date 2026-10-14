## ADDED Requirements

### Requirement: Confirmed question duplicates notify their authors

When a TA or instructor successfully changes an active question to `duplicateStatus: confirmed`, the system SHALL durably queue one email notification to that question's author as part of the successful merge transaction. The email SHALL have the subject `Your post has been marked as a duplicate`. Its plain-text body SHALL say `Your question "<question>" was marked as a duplicate by <staff name> (<instructor or TA>).` and include an absolute link to the canonical post. The merge API's response and ETag SHALL remain unchanged. Temporary mail delivery failures SHALL NOT undo an already committed merge; the queued notification SHALL be retried. Delivery may be repeated only in the SMTP acceptance/crash ambiguity inherent in at-least-once delivery.

Only a successful confirmation of a question SHALL queue this notification. A suggestion, failed or stale PATCH, note merge, unmerge, pin change, or other update SHALL NOT. Before sending, the system SHALL confirm that the source remains merged to that canonical target and that the author is an active account with current access to the course; otherwise it SHALL cancel the pending notification without sending. A later successful re-merge SHALL be a new event and MAY queue a new email.

#### Scenario: Staff confirm a question duplicate

- **WHEN** a TA or instructor confirms an active question as a duplicate with a current ETag
- **THEN** the merge succeeds with its documented minimal canonical-reference response, and exactly one notification is queued for the author with the required subject, staff name and role, question title, and canonical-post link

#### Scenario: SMTP is temporarily unavailable

- **WHEN** mail delivery fails after a question merge has committed
- **THEN** the merge remains confirmed and the notification remains retryable without another merge request

#### Scenario: A non-confirmation update occurs

- **WHEN** a duplicate is suggested, a note is merged, a merge request fails, or staff unmerge a question
- **THEN** no question-merge notification is queued for that operation

#### Scenario: A queued merge becomes stale before delivery

- **WHEN** the source is unmerged or its author loses current course access before the worker sends the queued email
- **THEN** the worker does not send a stale or inaccessible canonical link
