## MODIFIED Requirements

### Requirement: Publish from a current draft revision atomically

The existing JSON create-post operation SHALL optionally accept the owner's course draft version. If supplied, it SHALL match the current resource version before creation; a stale version SHALL return `412 version_conflict` without creating a post. The supplied complete post body remains authoritative and SHALL be validated under ordinary creation rules. A successful create SHALL clear any current owner/course draft content and advance its content-free version marker in the same transaction as post creation and side effects; a failed create SHALL leave draft state intact. Replaying a matching unexpired `Idempotency-Key` SHALL return the original post result without rechecking a version already consumed or creating a duplicate. Creation without a draft version SHALL retain its prior post behavior while still clearing any saved course draft on success.

#### Scenario: Publish saved draft

- **WHEN** an owner publishes a valid post with a matching course draft version
- **THEN** the API returns the usual `201` post response, creates the post and side effects once, and clears draft content atomically

#### Scenario: Stale draft

- **WHEN** a member submits an earlier course draft version
- **THEN** the API returns `412 version_conflict`, creates no post, and leaves the saved draft unchanged

#### Scenario: Stale or foreign draft

- **WHEN** a member submits a stale course draft version or attempts to publish in a course where they are not a member
- **THEN** the request fails without creating a post or exposing another owner's draft

#### Scenario: Failed publish

- **WHEN** full post validation or a transactional write fails while publishing a draft
- **THEN** no post is committed and draft content remains available

#### Scenario: Publish fails validation or persistence

- **WHEN** post validation or a transactional insert fails
- **THEN** draft content and version remain unchanged and no post is committed

#### Scenario: Idempotent replay

- **WHEN** the client repeats the same draft-backed create request with the same valid idempotency key after the first request committed
- **THEN** the original post response is returned and no second post is created

#### Scenario: Idempotent publish retry

- **WHEN** the same valid idempotency key and payload are retried after successful publication
- **THEN** the original response returns without a duplicate post or additional draft-marker advance
