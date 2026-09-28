## ADDED Requirements

### Requirement: Posts show when they were created

Each ordinary feed card, the post detail pane, and the staff duplicate-review detail pane SHALL show the post's server-returned `createdAt` beside the displayed author. The visible text SHALL be relative to the viewer's current time: "just now" under one minute, then English minutes, hours, and days ago, such as "3 hours ago", for up to seven days. Posts older than seven days SHALL show a short English calendar date such as "Sep 20", including the year only when it differs from the current year. Dates and hover text SHALL use the viewer's local time zone. Every displayed time SHALL be a semantic time element whose machine-readable value is the original `createdAt` and whose hover text gives the full local date and time. A `createdAt` in the future SHALL display as "just now". If `createdAt` cannot be parsed as a date, the browser SHALL omit the time rather than show invalid text.

The time SHALL be shown beside "Anonymous" and "Deleted user" without changing the viewer-projected author. The browser SHALL not display `updatedAt` or `lastActivityAt`, nor mark any post as edited. Staff duplicate-review cards, related-question suggestions, and deleted-post tombstones SHALL not gain a time.

#### Scenario: A member browses the feed

- **WHEN** a course member views a feed card for a post created three hours earlier
- **THEN** the card shows the author followed by a relative time such as "3 hours ago", and hovering it shows the full local date and time

#### Scenario: A member opens an older post

- **WHEN** a member opens the detail pane for a post created more than seven days earlier
- **THEN** the pane shows a short calendar date beside the author instead of a relative time

#### Scenario: An anonymous post shows its time

- **WHEN** a student views another student's anonymous post
- **THEN** the byline shows "Anonymous" with the creation time and no identifying author information

#### Scenario: A staff member was the last to change a post

- **WHEN** staff pin or merge-review a post after it was created, so its `updatedAt` is later than its `createdAt`
- **THEN** the post still shows only its creation time and no edited or updated indicator

#### Scenario: Staff review a duplicate

- **WHEN** a TA selects a card in Duplicate posts
- **THEN** the right-hand review pane shows the source's creation time beside its staff-visible author, while the review card itself still shows only the title and merged-into link
