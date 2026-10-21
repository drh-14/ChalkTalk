# Spec Delta

## ADDED Requirements

### Requirement: Markdown bodies can mention members

A mention SHALL be written `[@Display text](mention:<userId>)` inside the Markdown body of a post, answer, followup, or reply, and `@staff` SHALL mention every current TA and instructor. Mentions inside code spans and code blocks SHALL be ignored. Rendered Markdown SHALL show a mention as its display text styled as a mention, and not as a link.

#### Scenario: A mention renders as a name

- **WHEN** a body contains `[@Grace Hopper](mention:<id>)`
- **THEN** readers see "@Grace Hopper" highlighted, with no link

### Requirement: Mentioned members are notified

Creating a post, answer, followup, or reply SHALL create one `mentioned` notification for each mentioned user who:

- is a current course member with an account that is not deleted;
- can read the post;
- is not the author of the write.

Editing a body SHALL notify only users who were not mentioned in the previous body. A user who is both mentioned and a follower SHALL receive only the `mentioned` notification for that write. The notification SHALL record whether the content was anonymous, and the actor SHALL be shown as "Anonymous" to students exactly as for other notifications. A body that mentions more than 20 individual users SHALL be rejected with `422 too_many_mentions`, and `@staff` SHALL count as one. Mention notifications SHALL follow the activity-email preference.

#### Scenario: A student pings a TA

- **WHEN** a student posts a followup mentioning a TA who does not follow the question
- **THEN** the TA receives one `mentioned` notification

#### Scenario: A private post does not leak

- **WHEN** a student mentions a classmate in a private post
- **THEN** the classmate receives no notification

#### Scenario: An anonymous mention stays anonymous

- **WHEN** a student mentions a classmate in an anonymous reply
- **THEN** the classmate's notification shows the actor as "Anonymous"

### Requirement: The editor suggests members

`GET /api/v1/courses/{courseId}/mention-suggestions?q=<prefix>` SHALL return up to 8 current members whose display names contain the query, ignoring case, as `{ userId, displayName, role }`, excluding the caller and deleted accounts. With `postId`, it SHALL return only members who can read that post. It SHALL require course membership, `q` SHALL be 0 to 50 characters, and other query keys SHALL return `400 invalid_request`. Typing `@` in any Markdown editor SHALL show these suggestions with **@staff** first, and choosing one SHALL insert the mention token.

#### Scenario: A student mentions a classmate

- **WHEN** a student types `@gra` in a followup
- **THEN** "Grace Hopper" is suggested, and choosing it inserts `[@Grace Hopper](mention:<id>)`

### Requirement: Tests cover mentions

API tests SHALL cover:

- parsing, including code exclusion and `@staff`;
- notification fan-out by membership, readability, deletion, and actor;
- edits notifying only new mentions;
- deduplication with follower notifications;
- anonymity, the limit, and the suggestions endpoint.

Worker tests SHALL cover the email wording. Component tests SHALL cover rendering, autocomplete, and the bell wording. A browser test SHALL show a student mentioning a TA and the TA seeing the notification.

#### Scenario: A mention leaks a private post

- **WHEN** a change notifies a mentioned member who cannot read the post
- **THEN** an automated test fails
