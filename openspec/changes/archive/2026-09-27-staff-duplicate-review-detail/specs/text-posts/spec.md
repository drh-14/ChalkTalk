## ADDED Requirements

### Requirement: Staff can inspect a retained confirmed duplicate

`GET /api/v1/posts/{postId}/duplicate-review` SHALL return the existing full active post projection of a confirmed duplicate only to a current TA or instructor in its course, including retained title, body, tags, staff-visible author, duplicate fields, and version. A successful response SHALL carry the current ETag and `Cache-Control: private, no-store` and SHALL NOT redirect. A current student member SHALL receive `403`; a nonmember, absent, deleted, or nonconfirmed post SHALL receive `404`. The ordinary post GET SHALL continue redirecting confirmed duplicates to their canonical post, and the staff duplicate list SHALL remain summary-only.

#### Scenario: A TA reviews a confirmed duplicate

- **WHEN** a current TA requests a confirmed duplicate's review detail
- **THEN** the API returns its retained full post projection, current ETag, and no-store caching

#### Scenario: A student attempts to read retained duplicate text

- **WHEN** a current student member requests the review detail
- **THEN** the API returns `403` without retained text
