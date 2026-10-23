## ADDED Requirements

### Requirement: Members can organize their feed by personal state

The Show control SHALL offer Unread, Following, and Saved in addition to its existing filters. Each choice SHALL preserve the applied search, tags, and sort; it SHALL store the filter in the URL and restore it on navigation. A readable post SHALL provide a keyboard-accessible save/unsave control with visible and assistive-technology state. The saved list SHALL contain one personal set, not named lists or staff-managed reading lists. A failed save SHALL show an error and leave the visible state consistent with the server.

#### Scenario: Open the saved list

- **WHEN** a member chooses Saved in Show
- **THEN** the feed requests `saved=true`, displays only returned saved posts, and retains the choice in the URL

#### Scenario: Unsave from the saved list

- **WHEN** a member unsaves a post while viewing Saved
- **THEN** the post leaves the saved list without changing its follow or read state

### Requirement: New posts do not interrupt the current feed

While a member views the course feed, the browser SHALL periodically check for newly created posts matching the active filters against a server-issued snapshot. When the count is positive it SHALL show an accessible refresh prompt with that count. The existing cards, order, page cursor, selected detail, and unsent composer SHALL remain unchanged until the member activates the prompt. Activating it SHALL fetch a fresh first page using the current filters and dismiss the prompt. Changing filters or course SHALL discard the old prompt and baseline. Failed checks SHALL not replace the visible feed or falsely report zero new posts.

#### Scenario: Matching new posts

- **WHEN** two new posts match the active filters while a member reads the feed
- **THEN** a prompt announces two new posts and the existing list and selected detail do not move

#### Scenario: Nonmatching new post

- **WHEN** a newly created post does not match the active filters
- **THEN** no prompt appears

#### Scenario: Member refreshes the feed

- **WHEN** the member activates a new-post prompt
- **THEN** the feed retrieves a fresh first page under the current filters without closing the selected detail or composer
