## Purpose

Provide course members with a secure, complete in-app notification history for responses and staff moderation through the existing global bell.

## ADDED Requirements

### Requirement: Response cards

The notification list SHALL preserve existing events and SHALL include a typed response reference, a current plain-text excerpt of at most three nonblank lines and 360 characters, and an exact answer or followup destination for referenced response events. The post author or parent followup author SHALL see owner-focused wording when eligible under existing follow/mention rules. An explicit unfollow SHALL continue to suppress follower events. Deleted responses SHALL expose no old body and SHALL use a text-free fallback and post destination. Actor anonymity and current post access SHALL remain enforced.

#### Scenario: Followed answer

- **WHEN** another member answers a followed question and the author lists notifications
- **THEN** the author sees who replied, a bounded excerpt of the current answer, and a destination for that answer

#### Scenario: Unfollowed question

- **WHEN** the author explicitly unfollows before a response
- **THEN** no follower response notification is created for that author

#### Scenario: Deleted or inaccessible response

- **WHEN** a response is deleted or the recipient loses access
- **THEN** its old text is never returned, and inaccessible events do not appear in list or unread count

### Requirement: Staff moderation cards

The post author SHALL receive an in-app event when a different current TA or instructor changes the post title/body, confirms a question merge, or deletes the post. Metadata-only changes, stale requests, unmerges, self-actions, and note merges SHALL NOT create these events. A merge SHALL take precedence over a simultaneous text edit. A merge card SHALL target the readable canonical post and disappear if the merge is undone or its canonical target is unavailable. A deletion card SHALL retain no post title/body, use generic wording, and target the course feed. Leaving the course SHALL hide these events.

#### Scenario: Meaningful staff edit

- **WHEN** staff changes another member's post title or body
- **THEN** exactly one author-targeted edit card is created in the same transaction

#### Scenario: Confirmed question merge

- **WHEN** staff confirms another member's question as a duplicate
- **THEN** exactly one merge card links to the canonical post and no edit card is created for that operation

#### Scenario: Staff deletion

- **WHEN** staff deletes another member's post
- **THEN** exactly one generic deletion card links to the course feed without retaining deleted text

#### Scenario: Unmerged question

- **WHEN** staff undo the merge after the card was created
- **THEN** the card is absent from both list and unread count

### Requirement: Complete bell browsing

The existing bell SHALL show rectangular, keyboard-operable cards in a bounded scroll region, SHALL preserve existing close/read behavior, and SHALL expose a visible Load more control while another cursor page exists. A page failure SHALL preserve already loaded cards and offer retry.

#### Scenario: Additional page

- **WHEN** the first page reports another cursor
- **THEN** selecting Load more appends the next visible page without discarding existing cards

#### Scenario: Page failure

- **WHEN** loading another page fails
- **THEN** existing cards remain and the user can retry
