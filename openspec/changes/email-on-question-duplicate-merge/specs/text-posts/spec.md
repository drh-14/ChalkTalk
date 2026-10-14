## ADDED Requirements

### Requirement: Confirmed question duplicates notify their authors

When a TA or instructor successfully changes an active question to `duplicateStatus: confirmed`, the system SHALL durably queue one email notification to that question's author as part of the successful merge transaction. The email SHALL have the subject `Your post has been marked as a duplicate`. For an active confirming staff account, its plain-text body SHALL say `Your question "<question>" was marked as a duplicate by <staff name> (<instructor or TA>).` If that staff account has been deleted before delivery, the body SHALL instead say `Your question "<question>" was marked as a duplicate by a TA.` or `Your question "<question>" was marked as a duplicate by an instructor.`, according to the confirming role. The notification SHALL include an absolute link to the canonical post. The queued job SHALL NOT retain the staff display name. The merge API's response and ETag SHALL remain unchanged. Temporary mail delivery failures SHALL NOT undo an already committed merge; the queued notification SHALL be retried. Delivery may be repeated only in the SMTP acceptance/crash ambiguity inherent in at-least-once delivery.

Only a successful confirmation of a question SHALL queue this notification. A suggestion, failed or stale PATCH, note merge, unmerge, pin change, or other update SHALL NOT. Before sending, the system SHALL confirm that the source remains merged to that canonical target and that the author is an active account with current access to the course; otherwise it SHALL cancel the pending notification without sending. A later successful re-merge SHALL be a new event and MAY queue a new email.

#### Scenario: Staff confirm a question duplicate

- **WHEN** a TA or instructor confirms an active question as a duplicate with a current ETag
- **THEN** the merge succeeds with its documented minimal canonical-reference response, and exactly one notification is queued for the author; if the confirming staff account is active at delivery, the email has the required subject, question title, canonical-post link, and staff name and role

#### Scenario: Confirming staff account is deleted before delivery

- **WHEN** the confirming TA or instructor account is deleted after a successful question merge but before notification delivery
- **THEN** the author receives the email with an unnamed label for the confirming role, without retaining or exposing the deleted staff member's display name

#### Scenario: Canonical target has a duplicate suggestion

- **WHEN** staff confirm a question duplicate against an active same-course target whose own duplicate status is suggested
- **THEN** the notification is queued and delivered while that target remains suggested

#### Scenario: SMTP is temporarily unavailable

- **WHEN** mail delivery fails after a question merge has committed
- **THEN** the merge remains confirmed and the notification remains retryable without another merge request

#### Scenario: A non-confirmation update occurs

- **WHEN** a duplicate is suggested, a note is merged, a merge request fails, or staff unmerge a question
- **THEN** no question-merge notification is queued for that operation

#### Scenario: A queued merge becomes stale before delivery

- **WHEN** the source is unmerged or its author loses current course access before the worker sends the queued email
- **THEN** the worker does not send a stale or inaccessible canonical link
