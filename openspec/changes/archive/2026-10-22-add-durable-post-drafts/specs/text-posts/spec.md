## ADDED Requirements

### Requirement: Publish from a current draft revision atomically

The existing JSON create-post operation SHALL optionally accept a draft ID and positive integer draft version together. It SHALL require that draft to belong to the same current caller and course and have the supplied version. The supplied complete post body remains authoritative and SHALL be validated under the ordinary create-post rules. A successful create SHALL delete that one draft in the same transaction as post creation and its side effects; a failed create SHALL leave the draft intact. Replaying a matching unexpired `Idempotency-Key` SHALL return the original post result without requiring a draft that was already consumed, and SHALL NOT create a duplicate post. Creation without draft fields SHALL keep its prior behavior.

#### Scenario: Publish saved draft

- **WHEN** an owner publishes a valid post with a matching draft ID and version
- **THEN** the API returns the usual `201` post response, the post and side effects exist once, and the consumed draft no longer exists

#### Scenario: Stale or foreign draft

- **WHEN** a member submits a stale version, another user's draft ID, or a draft from another course
- **THEN** the API returns `412 version_conflict` for the stale owned draft or `404 not_found` for an inaccessible draft, creates no post, and leaves draft state unchanged

#### Scenario: Publish fails validation or persistence

- **WHEN** full post validation or a transactional write fails while publishing a draft
- **THEN** no post is committed and the draft remains available

#### Scenario: Idempotent publish retry

- **WHEN** the client repeats the same draft-backed create request with the same valid idempotency key after the first request committed
- **THEN** the original post response is returned and no second post is created even though the draft was consumed
