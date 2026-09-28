## MODIFIED Requirements

### Requirement: Members can create and retrieve text posts

The API SHALL support JSON `question` and `note` creation, course listing/search, and global-ID retrieval using the documented active post shape, response envelopes, `Location`, and ETag headers. Active posts SHALL expose `attachments: []`. Questions SHALL expose `answered: true` exactly when the question has at least one active, non-deleted student or staff answer, and `answered: false` otherwise. The `answered` course-list filter SHALL return only questions whose `answered` value matches it. Creating, endorsing, or deleting an answer SHALL update the question's last-activity time without changing the question's `version` or ETag. Creation SHALL honor a matching `Idempotency-Key` for 24 hours and reject conflicting reuse.

#### Scenario: A member creates a question

- **WHEN** an authenticated course member submits a valid JSON question with a title, Markdown body, and tags
- **THEN** the API returns `201`, `Location`, an ETag, a new post in that course, normalized tags, an empty attachment list, and `answered: false`

#### Scenario: A question receives an answer

- **WHEN** a course member creates the first answer to a question
- **THEN** later reads and list results report that question with `answered: true`, the `answered=true` filter includes it, and the `answered=false` filter excludes it

#### Scenario: A question's only answer is deleted

- **WHEN** staff delete the only active answer to a question
- **THEN** the question reports `answered: false` again

#### Scenario: A matching creation request is retried

- **WHEN** the same caller repeats the same create request with the same unexpired idempotency key
- **THEN** the API returns the original result without creating a second post

### Requirement: Course deletion cleans post data

The durable course-deletion worker SHALL remove answer contributors, answer collaboration documents, answers, post-tag links, posts, and tags before removing the course, without breaking retry after a partial cleanup failure.

#### Scenario: A course with posts is deleted

- **WHEN** course deletion is accepted and its worker completes
- **THEN** the course, its posts, their answers, and its tags are removed and the course becomes not found
