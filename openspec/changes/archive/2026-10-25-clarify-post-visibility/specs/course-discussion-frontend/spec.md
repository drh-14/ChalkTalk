## MODIFIED Requirements

### Requirement: A member can create a question or note

The accessible create control SHALL open a composer for type, title, Markdown body, anonymity, optional tags, and an explicit Visibility choice for questions and ordinary notes. Visibility SHALL default to **Public — everyone in course** and SHALL offer **Private — only you and current instructors/TAs** when the course permits private posting. Selecting Private SHALL send the existing `private: true` create field; Public SHALL not set it. Polls and announcements SHALL be public-only. The browser SHALL require a trimmed nonempty title of at most 200 characters and a trimmed nonempty body of at most 100,000 characters, matching the existing API limits. It SHALL submit JSON with credentials, CSRF token, and an idempotency key, disable repeat submission while pending, preserve the draft on failure, and navigate to the server-returned post on success. It SHALL reuse a key only for a retry of the same payload. Creation SHALL not be enabled for an archived or deleting course.

#### Scenario: A member creates a question

- **WHEN** a member submits a valid question from the course page with Public visibility
- **THEN** the browser sends the documented create request without `private: true` and opens the created post using the ID returned by the server

#### Scenario: A member asks staff privately

- **WHEN** a member selects Private visibility and submits a question or ordinary note
- **THEN** the browser sends the documented create request with `private: true` and identifies the intended readers as the author and current course instructors/TAs

#### Scenario: A poll or announcement cannot be private

- **WHEN** a staff member composes a poll or an announcement
- **THEN** the composer permits only public posting

#### Scenario: Creation fails

- **WHEN** the API rejects a create request
- **THEN** the browser shows the error, retains the entered draft, and permits a deliberate retry without duplicate submission

#### Scenario: The draft exceeds a documented limit

- **WHEN** a member enters a title longer than 200 characters or a body longer than 100,000 characters
- **THEN** the composer identifies the invalid field and does not send a create request
