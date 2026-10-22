# Spec Delta

## ADDED Requirements

### Requirement: Followup discussions are resolved or unresolved

Every root followup (one without a parent) SHALL be a discussion that is either resolved or unresolved, and SHALL start unresolved. Followup projections SHALL include `resolved` (always `false` for replies) and `canResolve`, which is true when the viewer may change the state of an active root followup in an active course.

#### Scenario: A new discussion needs attention

- **WHEN** a student posts a followup on a question
- **THEN** the followup reports `resolved: false`

### Requirement: Staff and the question's author resolve discussions

`PUT /api/v1/followups/{followupId}/resolution` SHALL mark a root followup resolved, and `DELETE` on the same path SHALL mark it unresolved. Both SHALL be idempotent, require CSRF protection, and return `200` with the followup. Only TAs, instructors, and the question's author SHALL be allowed; other members SHALL receive `403 permission_denied`. A reply SHALL return `422 not_a_discussion`, a deleted followup or one the caller cannot read SHALL return `404 not_found`, and an archived course SHALL return `409 course_archived`. Changing the state SHALL change neither the followup's `version` nor the question's `lastActivityAt`.

#### Scenario: A TA closes a thread

- **WHEN** a TA resolves a discussion
- **THEN** it reports `resolved: true`, and its version and the question's last activity are unchanged

#### Scenario: A classmate cannot resolve

- **WHEN** a student who did not ask the question tries to resolve a discussion on it
- **THEN** the API returns `403 permission_denied`

### Requirement: New replies reopen a resolved discussion

Creating a reply anywhere in a resolved discussion, at any depth, SHALL make that discussion unresolved in the same transaction.

#### Scenario: A student replies after staff resolved

- **WHEN** a student replies to a nested reply in a resolved discussion
- **THEN** the discussion reports `resolved: false`

### Requirement: Questions expose an unresolved queue

Question projections SHALL include `unresolvedFollowups`, the number of active, unresolved root followups. `GET /api/v1/courses/{courseId}/posts` SHALL accept `unresolvedFollowups=true` to list only questions with at least one, and any other value SHALL return `400 invalid_request`. The filter SHALL obey the same visibility rules as every other list, including private posts.

#### Scenario: Staff work through the queue

- **WHEN** a TA lists posts with `unresolvedFollowups=true`
- **THEN** only questions with an unresolved discussion appear, and resolving the last one removes the question from that list

### Requirement: The interface shows and changes the state

Each root followup SHALL show **Resolved** or **Unresolved**. Members who may change it SHALL get a control to switch it, and other members SHALL see a label. Question cards in the feed SHALL show "N unresolved" when N is greater than 0. TAs and instructors SHALL see an **Unresolved** feed filter.

#### Scenario: A TA clears a question from the queue

- **WHEN** a TA opens a question from the **Unresolved** filter and marks its only discussion resolved
- **THEN** the discussion shows **Resolved** and the question's card no longer shows an unresolved count

### Requirement: Tests cover followup triage

API tests SHALL cover:

- the default state;
- resolving and reopening by each permitted role, and the refusals;
- replies, deleted followups, private posts, and archived courses;
- unchanged versions and activity;
- reopening by nested replies;
- the count and the filter.

Component tests SHALL cover the control, the label, the badge, and the filter. A browser test SHALL show a TA resolving a discussion from the queue and a student's reply reopening it.

#### Scenario: A reply stops reopening a discussion

- **WHEN** a change lets a new reply leave its discussion resolved
- **THEN** an automated test fails
