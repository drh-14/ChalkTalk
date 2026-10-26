## Purpose

Give an opted-in follower a concise, private email for a newly created response and a link that opens that exact response in its discussion.

## ADDED Requirements

### Requirement: Response email identifies the response and links to it

For a newly created answer, root followup, or nested reply, an otherwise eligible activity or mention notification email SHALL include a plain-text excerpt bounded to approximately three nonempty logical lines and a finite length, plus a URL identifying that exact response. It SHALL preserve the existing recipient deduplication, course activity-email preference, and anonymous actor display. Other activity emails SHALL retain their existing post-level link and wording. Older queued jobs without a response reference SHALL remain safely deliverable at the post level.

#### Scenario: An answer is posted

- **WHEN** a member posts a new answer and an opted-in follower has an unread notification
- **THEN** the delivered email includes the answer excerpt and an answer-specific URL

#### Scenario: A nested reply is posted

- **WHEN** a member posts a nested reply that mentions a follower
- **THEN** the follower receives one mention email with the reply excerpt and its exact URL

#### Scenario: An older queued email is delivered

- **WHEN** a queued notification job has no response reference
- **THEN** it can be delivered with its existing post link, subject to all current privacy checks

### Requirement: Delivery respects current recipient and content state

The worker SHALL send response activity email only while its in-app notification is unread, the recipient remains a current member with activity email enabled, the post and referenced response remain readable and undeleted, and the recipient remains eligible to receive that notification. An explicit unfollow SHALL suppress follower activity mail even if the job was previously queued; a direct mention SHALL remain independent of follow state. Private audience and anonymity rules SHALL be enforced at delivery. An email already in flight MAY finish after a preference or follow change.

#### Scenario: Follower opts out before delivery

- **WHEN** a follower unfollows the post before a queued response email is processed
- **THEN** the worker sends no follower activity email

#### Scenario: Reader loses access before delivery

- **WHEN** the recipient loses course membership or post audience access, or the response is deleted before the job is processed
- **THEN** the worker sends no response email or excerpt

#### Scenario: Notification was read before delivery

- **WHEN** the notification is marked read before the worker processes its job
- **THEN** no email is sent

### Requirement: Exact-response links reveal the target safely

A member opening an authorized answer or followup URL SHALL see the target response even when it was not in the initially loaded followup page or its ancestor replies are collapsed. The browser SHALL move focus and scroll to the response. Missing, deleted, hidden, and unauthorized targets SHALL not display stale or unauthorized content and SHALL leave the ordinary post view usable.

#### Scenario: Answer link opens directly

- **WHEN** an authorized member opens an answer-specific link
- **THEN** the matching answer is visible and brought into view

#### Scenario: Nested reply link opens directly

- **WHEN** an authorized member opens a link to a paginated nested reply
- **THEN** its ancestor discussion is revealed and the reply is visible and brought into view

#### Scenario: Target is unavailable

- **WHEN** a response link names a response the viewer cannot read
- **THEN** the browser does not reveal its content and the post remains usable
