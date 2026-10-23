## Purpose

Provide explicit, current-membership-scoped audiences for course questions and notes while keeping every dependent content and delivery surface inside the same privacy boundary.

## ADDED Requirements

### Requirement: A post has one audience

A question or non-announcement note SHALL select exactly one audience at creation: `class` (default), `staff`, `selected_staff`, or `group`. The existing `private: true` create request SHALL remain compatible and mean `staff`; existing private posts SHALL be `staff` posts, and existing public posts SHALL be `class` posts. `selected_staff` SHALL require at least one explicitly selected current TA or instructor from the same course, with no duplicate recipient; `group` SHALL require one existing staff-managed group in the same course. A group post's creator SHALL be a current member of that group. Polls and announcements SHALL be class-visible only. The API SHALL reject unknown, malformed, cross-course, incompatible, or ineligible selections without creating a post. The active post response SHALL identify its audience to an authorized reader without exposing restricted recipient details to an unauthorized reader.

#### Scenario: Selected staff does not include an instructor implicitly

- **WHEN** a current student creates a selected-staff question naming one current TA
- **THEN** the author and that TA can read it, and an unselected instructor receives `404 not_found`

#### Scenario: Group creator must belong to the group

- **WHEN** a current course member who does not belong to a group attempts to post to it
- **THEN** creation fails without persisting the post

#### Scenario: Legacy private request keeps its meaning

- **WHEN** a member creates a question with only `private: true`
- **THEN** it is visible to the author and all current course staff as a `staff` audience post

### Requirement: Staff manage private groups without a read override

Only current course TAs and instructors SHALL create, rename, delete, or alter the membership of private groups in their course. A member added to a group SHALL also be a current course member. Group names SHALL be unique within the course after trimming and case folding. A group referenced by any active post SHALL be renameable but SHALL NOT be deletable until no active post references it. Staff management rights SHALL NOT grant read access to posts addressed to a group of which that staff member is not currently a member. Group member additions and removals SHALL take effect on subsequent reads and writes without changing posts' audience or history.

#### Scenario: Managing staff is outside the group

- **WHEN** an instructor manages a group but is not a current member of it
- **THEN** the instructor can change group membership but receives `404 not_found` for posts addressed to it

#### Scenario: Referenced group cannot be removed

- **WHEN** staff tries to delete a group referenced by an active post
- **THEN** deletion fails and the group and post remain available to their authorized members

#### Scenario: Membership update changes access immediately

- **WHEN** staff removes an author from the group to which the author posted
- **THEN** that author can no longer read, edit, follow, or participate in the post or its discussion, even though they created it

### Requirement: Current audience access gates all content

Every post and parent-scoped operation SHALL require current course membership plus current audience access. For `class`, every current course member may read; for `staff`, the author or a current TA or instructor may read; for `selected_staff`, the author or a currently eligible explicitly selected staff member may read; for `group`, only a current member of that group may read, including the author. A role change SHALL immediately revoke a selected-staff recipient who is no longer staff. The same rule SHALL gate direct posts, list/search pagination and counts, related questions, duplicates, answers, followups, replies, upvotes, following, attachments and download URLs, notifications, and live-session discovery, invitation, join, replay, inbound updates, and outbound content. Unauthorized readers SHALL receive the same `404 not_found` or omission as for an absent post; no instructor override SHALL apply. A private post and its discussion SHALL remain absent from the daily course digest for every recipient, as under the existing private-post contract.

#### Scenario: Group removal hides the full discussion

- **WHEN** a removed group member requests a post, answer, attachment, or live-session content previously available to them
- **THEN** each request fails without revealing the restricted parent or descendant

#### Scenario: A hidden post does not affect discovery

- **WHEN** an unselected current member searches, filters, paginates, or requests related questions
- **THEN** restricted posts and their metadata do not appear in results, counts, or cursors

#### Scenario: Revoked live participant sees no new content

- **WHEN** a group member or selected-staff recipient loses access while connected to a live session
- **THEN** subsequent inbound actions are refused and no further restricted outbound content is sent, including queued or replayed content

#### Scenario: Recipient loses access before queued delivery

- **WHEN** a pending notification is delivered after its recipient loses audience access
- **THEN** neither in-app nor email delivery exposes its private content or link

### Requirement: Existing privacy lifecycle remains safe

An audience SHALL remain fixed for a non-public post until the existing one-way publish-to-class operation. Only its author while currently audience-authorized, or a currently audience-authorized staff member, SHALL publish it, subject to the existing conditional revision and course-state rules; a public post SHALL NOT become private. A private post SHALL NOT be a duplicate target for any post. Deletion, membership removal, role change, and group removal SHALL not re-expose retained private content, author identity, or descendant data. Publishing SHALL preserve the existing author notification and anonymity behavior.

#### Scenario: Unselected staff cannot publish a restricted post

- **WHEN** an instructor outside a selected or group audience requests publication by ID
- **THEN** the API returns `404 not_found` and the audience remains unchanged

#### Scenario: Publishing is one-way

- **WHEN** an authorized author publishes a group post under its current ETag
- **THEN** all current course members can read it, and a later attempt to make it private is rejected

### Requirement: Interface communicates audience and group membership

The new-post composer SHALL show the four mutually exclusive audience modes for questions and notes, the eligible staff or group selector for the chosen mode, and clear text describing who currently has access. It SHALL not offer private audiences for polls or announcements. Staff SHALL have a course-scoped group-management interface. An authorized reader SHALL see an accurate audience notice on a restricted post; inaccessible posts SHALL not appear in the feed or direct view. Audience-dependent controls SHALL not expose names or identities beyond the viewer's existing course permissions.

#### Scenario: Compose to a managed group

- **WHEN** a member chooses a group to which they currently belong
- **THEN** the composer identifies that group as the sole audience and allows a valid question or note to be submitted

#### Scenario: Lost group membership while composing

- **WHEN** group membership is removed before submission
- **THEN** submission is rejected and the UI displays a recoverable error without silently switching to another audience
