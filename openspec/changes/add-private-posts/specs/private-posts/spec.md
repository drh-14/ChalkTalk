# Spec Delta

## ADDED Requirements

### Requirement: Members post privately to staff

`POST /api/v1/courses/{courseId}/posts` SHALL accept `private` (boolean, default `false`) for questions and notes from any member who may post. A private post SHALL be readable only by its author and the course's current TAs and instructors. `private: true` SHALL return `422 private_announcement` together with `announcement: true`, and `422 private_poll` for a poll. Every active post projection SHALL include `private`.

#### Scenario: A student asks staff privately

- **WHEN** a student creates a question with `private: true`
- **THEN** the student, every TA, and every instructor in the course can read it
- **AND** another student receives `404 not_found` for it

#### Scenario: An announcement cannot be private

- **WHEN** an instructor creates a note with `announcement: true` and `private: true`
- **THEN** the API returns `422 private_announcement`

### Requirement: Private posts stay hidden from other members

For a member who is neither the author nor a TA or instructor, a private post SHALL behave exactly like a post that does not exist:

- reading, updating, voting, following, or any other operation on it, or on its answers, followups, replies, attachments, upvotes, or live sessions, SHALL return `404 not_found`;
- it SHALL be omitted from course lists, search results, related-question suggestions, and the duplicate-review list;
- it, its answers, and its followups SHALL be omitted from the daily course digest for every recipient;
- it SHALL create no notification for that member, and an existing notification of theirs about it SHALL not be listed or counted.

A live session anchored to a private post SHALL be readable and joinable only by members who can read the post, and inviting anyone else SHALL return `422 invitee_cannot_read_post`. Course statistics MAY count private posts, because they show only aggregate numbers.

#### Scenario: A classmate searches for a private question

- **WHEN** a student searches for words that appear only in another student's private question
- **THEN** the results do not include it

#### Scenario: An answer link to a private post is shared

- **WHEN** a student who is not the author requests an answer on a private question by its URL
- **THEN** the API returns `404 not_found`

### Requirement: Private posts can be made public

The author or any TA or instructor SHALL be able to make a private post public with `PATCH /api/v1/posts/{postId}` and `{ "private": false }`, under the usual `If-Match` revision check. The post SHALL keep its anonymity, content, answers, and followups. `private: true` on an update SHALL return `422 post_already_public` for a public post, and SHALL be ignored for a post that is already private. When a TA or instructor makes another member's post public, the author SHALL receive a `post_published` notification, which follows the existing email preference.

#### Scenario: A TA shares a common question

- **WHEN** a TA makes a student's private question public
- **THEN** every course member can read it, it still shows "Anonymous" to students if it was anonymous, and the student receives a `post_published` notification

#### Scenario: A public post cannot become private

- **WHEN** an author sends `{ "private": true }` for their public post
- **THEN** the API returns `422 post_already_public` and the post stays public

### Requirement: Duplicates never point at a private post

Marking a post as a suggested or confirmed duplicate of a private post SHALL return `422 duplicate_target_private`. A private post MAY be marked as a duplicate of a public post.

#### Scenario: Staff merge a public question into a private one

- **WHEN** a TA confirms a public question as a duplicate of a private question
- **THEN** the API returns `422 duplicate_target_private`

### Requirement: The interface shows privacy

The composer SHALL offer **Post to: Entire class** (default) or **Instructors and TAs** for questions and notes, and SHALL disable the announcement option while **Instructors and TAs** is chosen. Private posts SHALL show a **Private** badge in the feed and the notice "Only you and course staff can see this" on the post for its author, and "Only the author and course staff can see this" for staff. The feed SHALL offer a **Private** filter, `private=true` in the list API, which lists the private posts the viewer can read. The author and staff SHALL see **Make public** on a private post, and it SHALL ask for confirmation before publishing.

#### Scenario: A student reviews their private questions

- **WHEN** a student chooses the **Private** filter
- **THEN** the feed lists only their own private posts, each with a **Private** badge

### Requirement: Tests cover private posts

API tests SHALL cover creating private posts and the rejected combinations, reading and listing by role, the `private=true` filter, search and related questions, answers, followups, replies, attachments, upvotes, following, live sessions and their invitations, notifications and their fan-out, the digest, the duplicate rule, and making a post public with its notification. Component tests SHALL cover the composer choice, badge, notice, filter, and **Make public**. A browser test SHALL show a student posting privately, a classmate not finding it, a TA answering it and making it public, and the classmate then finding it.

#### Scenario: A read path leaks a private post

- **WHEN** a change lets a classmate read a private post, or anything attached to it, through any endpoint
- **THEN** an automated test fails
