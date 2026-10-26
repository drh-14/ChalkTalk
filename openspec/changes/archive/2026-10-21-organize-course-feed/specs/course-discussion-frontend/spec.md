### Requirement: New-post count is passive and does not interrupt the feed

While a member views the course feed, the browser SHALL periodically check for newly created posts matching the active filters against a server-issued snapshot. When the count is positive it SHALL show a passive accessible status whose text is exactly `1 new post` or `<count> new posts`. The status SHALL occupy a stable position above, not within, the scrolling card list and SHALL NOT be a button, link, or other refresh control. The existing cards, order, page cursor, selected detail, and unsent composer SHALL remain unchanged as the count changes. A normal browser refresh MAY load the new posts. Changing filters or course SHALL discard the old count and baseline. Failed checks SHALL not replace the visible feed or falsely report zero new posts.

#### Scenario: Matching new posts

- **WHEN** two new posts match the active filters while a member reads the feed
- **THEN** an accessible status reads exactly `2 new posts`, offers no click action, and the existing list and selected detail do not move

#### Scenario: Nonmatching new post

- **WHEN** a newly created post does not match the active filters
- **THEN** no new-post status appears

#### Scenario: Member refreshes the browser

- **WHEN** the member refreshes the browser normally after seeing a positive count
- **THEN** the feed retrieves a fresh first page under the current filters; the status itself does not perform this action

#### Scenario: Composer remains undisturbed

- **WHEN** the new-post count changes while a member has unsent composer text
- **THEN** the text remains intact and no navigation or feed reload occurs
