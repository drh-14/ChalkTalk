# Database schema

ChalkTalk uses PostgreSQL. IDs use `uuid_v7`. Mutable resources generally include `created_at`, `updated_at`, and `version`; a nullable `deleted_at` retains a tombstone where needed. `pg_trgm` supports fuzzy matching, and full-text indexes support post and resource-region search.

## Identity and access

### `organizations`

- `id`: `uuid_v7`; primary key.
- `domain`: `varchar(253)`; unique school domain, stored normalized (trimmed and lowercased).
- `name`: `varchar(200)`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `users`

- `id`: `uuid_v7`; primary key.
- `organization_id`: `uuid_v7`; foreign key to `organizations.id`.
- `email`: `varchar(320)`; unique while active and stored normalized (trimmed and lowercased).
- `display_name`: `varchar(100)`.
- `password_hash`: `text`.
- `deleted_at`: `timestamptz`, nullable.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `email_verification_tokens`

- `id`: `uuid_v7`; primary key.
- `email`: `varchar(320)`; stored normalized (trimmed and lowercased).
- `token_hash`: `bytea`; unique.
- `expires_at`, `consumed_at`, `superseded_at`: `timestamptz`; the latter two are nullable.
- `consumed_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `created_at`: `timestamptz`.

### `password_reset_tokens`

- `id`: `uuid_v7`; primary key.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `token_hash`: `bytea`; unique.
- `expires_at`, `consumed_at`, `created_at`: `timestamptz`; `consumed_at` is nullable.

### `sessions`

- `id`: `uuid_v7`; primary key.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `cookie_credential_hash`: `bytea`; unique.
- `csrf_token_hash`: `bytea`; HMAC digest of the session-bound opaque CSRF credential.
- `(id, user_id)`: unique key used by session-bound ticket foreign keys.
- `authenticated_at`, `expires_at`, `revoked_at`, `created_at`: `timestamptz`; `revoked_at` is nullable.

### `idempotency_records`

- `scope`: `text`; includes the operation and its authorization context.
- `key`: `varchar(255)`; client-supplied idempotency key.
- `(scope, key)`: composite primary key.
- `request_hash`: `bytea`.
- `state`: `text`; `processing` or `completed`.
- `response_status`: `integer`, nullable.
- `response_headers`, `response_body`: `jsonb`, nullable.
- `created_at`, `updated_at`, `expires_at`: `timestamptz`.

### `rate_limit_buckets`

- `action`: `varchar(100)`; rate-limited operation.
- `subject_hash`: `bytea`; hashed identity being limited.
- `window_start`: `timestamptz`; start of the rate-limit window.
- `(action, subject_hash, window_start)`: composite primary key.
- `request_count`: `integer`.
- `expires_at`: `timestamptz`.

## Background work

### `digest_outbox`

- `id`: `uuid`; primary key.
- `recipient_user_id`: `uuid`; foreign key to `users.id`, cascading on deletion.
- `course_id`: `uuid`; foreign key to `courses.id`, cascading on deletion.
- `activity_date`: `date`; UTC date of the activity summarized.
- `(recipient_user_id, course_id, activity_date)`: unique key preventing duplicate queued intents.
- `status`: `queued`, `running`, `sent`, or `canceled`.
- `attempts`, `available_at`, `locked_by`, `locked_until`, `last_error`, `sent_at`, `created_at`, `updated_at`: claim, retry, and delivery state.

For delivery and visibility behavior, see the [daily course email digest](api/daily-course-email-digest.md).

Digest scheduling scans from the day after the cursor through yesterday (inclusive), using partial `created_at` indexes on visible posts, undeleted answers, and undeleted followups before grouping activity by UTC day.

### `digest_schedule_state`

- `singleton`: fixed `true` primary key.
- `last_scanned_date`: `date`; most recent UTC activity date considered for outbox generation. The migration initializes it to the UTC day before deployment, making the deployment day the first eligible activity date. The scheduler locks and advances this row in the same transaction as the outbox insert, so concurrent replicas and restarts agree on catch-up progress.

### `jobs`

- `id`: `uuid_v7`; primary key.
- `kind`: `varchar(100)`.
- `payload`: `jsonb`.
- `status`: `text`; `queued`, `running`, `succeeded`, or `dead`.
- `deduplication_key`: `text`, nullable.
- `attempts`, `max_attempts`: `integer`.
- `available_at`, `locked_until`, `finished_at`, `created_at`, `updated_at`: `timestamptz`; lock and completion times are nullable.
- `locked_by`, `last_error`: `text`, nullable.
- `delete_course` jobs remove a course and its dependent content. `send_question_duplicate_email` jobs use a `source-post-id:source-version` deduplication key and a payload containing source post ID, canonical post ID, acting staff user ID, and role. For notification behavior, see [Update post](api/posts.md#updatePost).

## Courses and membership

### `courses`

- `id`: `uuid_v7`; primary key.
- `organization_id`: `uuid_v7`; foreign key to `organizations.id`.
- `created_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `name`: `varchar(200)`.
- `status`: `text`; `active`, `archived`, or `deleting`.
- `join_code`: `char(8)`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `course_memberships`

- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(course_id, user_id)`: composite primary key.
- `role`: `text`; `student`, `ta`, or `instructor`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

Account deletion locks each affected `courses` row before testing instructor cardinality. Any future writer that adds, removes, or changes an instructor membership must lock the same course row first; this shared protocol prevents a concurrent mutation from deleting a course's final instructor.

## Posts, answers, and polls

### `posts`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `author_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `(course_id, id)`: unique key used by same-course foreign keys.
- `type`: `text`; `question`, `note`, or `poll`.
- `title`: `varchar(200)`, nullable.
- `body_markdown`: `text`, nullable.
- `anonymous`, `pinned`: `boolean`.
- `duplicate_of_post_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `posts(course_id, id)`.
- `duplicate_status`: `text`; `none`, `suggested`, or `confirmed`.
- Confirming a duplicate retains the original title and body in this row. Application reads exclude confirmed rows from ordinary lists and search, redirect direct links to the active canonical row, and expose only restricted title/target metadata to staff review. Unmerge restores the retained content. The application blocks deleting or merging a canonical row while confirmed rows refer to it; this lifecycle rule is not enforced by the foreign key alone.
- `last_activity_at`, `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.
- `search_vector`: generated `tsvector`, nullable.
- Active post titles and bodies have separate GIN trigram indexes (`posts_title_trgm_idx`, `posts_body_trgm_idx`) for ordinary fuzzy search. Migration `007_post_fuzzy_search.sql` installs `pg_trgm` in `public` and qualifies its functions, operators, and operator classes because API tests use isolated schemas in their search paths. The extension must be available and installable in each deployment database; the migration fails if it is not.

### `tags`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `name`: `varchar(100)`; stored normalized (trimmed and lowercased).
- `(course_id, name)`: unique key.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `post_tags`

- `post_id`: `uuid_v7`; foreign key to `posts.id`.
- `tag_id`: `uuid_v7`; foreign key to `tags.id`.
- `(post_id, tag_id)`: composite primary key.

The application must verify that a post and tag belong to the same course before creating a `post_tags` row.

### `poll_options`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`.
- `(course_id, id)`: unique key.
- `(course_id, post_id, id)`: unique key for poll-vote validation.
- `position`: `smallint`; unique with `post_id`.
- `label`: `varchar(200)`.

### `poll_votes`

- `course_id`: `uuid_v7`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`; part of the primary key.
- `user_id`: `uuid_v7`; foreign key to `users.id`; part of the primary key.
- `option_id`: `uuid_v7`; with `course_id` and `post_id`, foreign key to `poll_options(course_id, post_id, id)`.
- `created_at`, `updated_at`: `timestamptz`.

### `answers`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`.
- `(course_id, id)`: unique key used by same-course foreign keys.
- `kind`: `text`; `student` or `staff`, exposed by the API. A partial unique index allows only one active answer of each kind per question.
- `created_by_user_id`: `uuid_v7`; creator account ID, preserved when membership later changes.
- `edit_role_floor`: `text`; immutable role snapshot (`student`, `ta`, or `instructor`). Student answers have a student floor. Staff answers keep the creating TA or instructor floor; migrated staff answers infer it from their sole first contributor's current membership, using instructor if the membership is absent or demoted. Migration rejects ambiguous multi-contributor history. A current editor's role must meet or exceed this floor.
- `body_markdown`: `text`, nullable.
- `anonymous`: `boolean`.
- `endorsed_at`: `timestamptz`, nullable.
- `endorsed_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

Content-changing conditional REST saves update Markdown, version, contributor history, and timestamps in one transaction and clear the current endorsement. Historical endorsement events remain.

### `answer_endorsement_events`

- `id`: `uuid`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `answer_id`: `uuid_v7`; with `course_id`, foreign key to `answers(course_id, id)`.
- `endorsed_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `endorsed_at`: `timestamptz`; append-only history of each endorsement. Legacy current endorsements are backfilled. Response-time statistics use the first event and remain stable after an edit clears the current endorsement.

### `answer_contributors`

- `answer_id`: `uuid_v7`; foreign key to `answers.id`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(answer_id, user_id)`: composite primary key; records the distinct set of editors for an answer.

The save-only migration checks nonempty historical Yjs documents in bounded pages against `answers.body_markdown` before dropping the old answer document table. It aborts on corrupt or divergent state. The original unseeded empty marker preserves the Markdown row. The Markdown column is the sole durable answer body after cutover.

### `followups`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to question `posts(course_id, id)`.
- `(course_id, id)` and `(course_id, post_id, id)`: unique keys used by same-course and same-question references.
- `parent_followup_id`: `uuid_v7`, nullable; with `course_id` and `post_id`, foreign key to a followup on the same question. Deleting a course cascades through descendants.
- `body_markdown`: `text`, nullable.
- `author_user_id`: `uuid_v7`; foreign key to `users.id`. A deleted account is hidden by response projection.
- `anonymous`: `boolean`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

Direct followups are indexed by `(post_id, parent_followup_id, created_at, id)`. Deleted roots or replies with children retain a bodyless tombstone; deleted leaves are excluded from ordinary reads.

The non-deleted answer body check retains historical empty strings from former live edits, but REST creation and saves require nonblank content. Followup and reply bodies remain nonblank REST content. Deleted rows still require `body_markdown IS NULL`.

### `answer_upvotes`

- `answer_id`: `uuid_v7`; foreign key to `answers.id` with cascade on physical deletion.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(answer_id, user_id)`: primary key, enforcing one vote per member per answer.
- `created_at`: `timestamptz`.

### `followup_upvotes`

- `followup_id`: `uuid_v7`; foreign key to `followups.id` with cascade on physical deletion.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(followup_id, user_id)`: primary key, enforcing one vote per member per followup.
- `created_at`: `timestamptz`.

### `content_attachments`

- `id`: `uuid_v7`; primary key.
- `post_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `posts(course_id, id)`.
- `answer_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `answers(course_id, id)`.
- `followup_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `followups(course_id, id)`.
- A `CHECK` constraint requires exactly one parent foreign key to be present.
- `course_id`: required foreign key to `courses.id`; course deletion cascades to the rows.
- `object_key`: required unique `text` key for the file-backed object store.
- `file_name`, `media_type`: required `text` values; the upload path validates the filename and file contents.
- `size_bytes`: required `bigint`, constrained to 1–104857600 bytes.
- `checksum_sha256`: required 32-byte `bytea`, used for exact-byte idempotent upload replay.
- `created_at`: `timestamptz`; `deleted_at`: nullable `timestamptz`. There is no processing status or `updated_at` column. Soft deletion hides the file immediately and queues object deletion for the separate worker; confirmed duplicate sources hide files without deleting their rows or bytes, and unmerge restores visibility.
- Partial indexes on each parent ID and attachment ID cover live rows (`deleted_at IS NULL`). At most five live rows per parent is enforced by the upload transaction, not a database constraint.

### `post_view_events`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `viewed_at`: `timestamptz`.
- `viewed_on`: UTC `date`; `(course_id, post_id, user_id, viewed_on)` is unique, so same-day reloads count once.

### `question_creation_daily_counts`

- `(course_id, user_id, created_on)`: primary key; references the course and creator but contains no post identifier.
- `created_on`: UTC `date` of question creation.
- `question_count`: positive integer. Each successful question creation increments the bucket in the post transaction. Soft deletion leaves it intact; account deletion removes the user's buckets, and course deletion removes the course's buckets.
- Migration backfills active questions only; questions deleted before deployment are not reconstructed in per-student counts. Course daily totals continue to use post creation timestamps.

### `answer_contribution_events`

- `id`: `uuid`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `answer_id`: `uuid_v7`; with `course_id`, foreign key to `answers(course_id, id)`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `contributed_at`: `timestamptz`; a creation or content-changing edit event. A later answer editor must insert this in its successful content persistence transaction.

## Course digest

### `course_digest_states`

- `course_id`: `uuid_v7`; primary key and foreign key to `courses.id`.
- `generated_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `course_digest_automatic_entries`

- `course_id`: `uuid_v7`; part of the primary key and foreign key to `course_digest_states.course_id`.
- `post_id`: `uuid_v7`; part of the primary key; with `course_id`, foreign key to `posts(course_id, id)`.
- `included_at`: `timestamptz`.
- `engagement_score`: `double precision`.

### `course_digest_manual_inclusions`

- `course_id`: `uuid_v7`; part of the primary key and foreign key to `course_digest_states.course_id`.
- `post_id`: `uuid_v7`; part of the primary key; with `course_id`, foreign key to `posts(course_id, id)`.
- `included_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `included_at`: `timestamptz`.

## Resources

### `resources`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `(course_id, id)`: unique key used by same-course foreign keys.
- `kind`: `text`; `upload` or `link`.
- `title`: `varchar(200)`.
- `description`: `varchar(2000)`.
- `status`: `text`; `processing`, `ready`, or `failed`.
- `external_url`, `object_key`, `media_type`: `text`, nullable.
- `size_bytes`: `bigint`, nullable.
- `checksum_sha256`: `bytea`, nullable.
- `processing_generation`, `version`: `bigint`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.

### `resource_regions`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `resource_id`: `uuid_v7`; with `course_id`, foreign key to `resources(course_id, id)`.
- `page`: `integer`.
- `bounds_x`, `bounds_y`, `bounds_width`, `bounds_height`: `double precision`.
- `title`: `varchar(200)`.
- `status`: `text`; `processing`, `ready`, or `failed`.
- `extracted_text`: `text`, nullable.
- `processing_generation`, `version`: `bigint`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `search_vector`: generated `tsvector`, nullable.

## Channels and messages

### `channels`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `(course_id, id)`: unique key used by subchannels.
- `name`: `varchar(200)`.
- `description`: `varchar(2000)`.
- `status`: `text`; `active` or `archived`.
- `last_activity_at`, `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

### `subchannels`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `channel_id`: `uuid_v7`; with `course_id`, foreign key to `channels(course_id, id)`.
- `(course_id, id)`: unique key used by collaboration sessions.
- `title`: `varchar(200)`.
- `status`: `text`; `active` or `archived`.
- `created_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `last_activity_at`, `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

### `messages`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`.
- `subchannel_id`: `uuid_v7`; with `course_id`, foreign key to `subchannels(course_id, id)`.
- `body_markdown`: `text`, nullable.
- `author_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `anonymous`, `is_introductory`: `boolean`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

## Collaboration

### `collaboration_sessions`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `(course_id, id)`: unique key used by course-bound tickets.
- `post_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `posts(course_id, id)`.
- `subchannel_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `subchannels(course_id, id)`.
- Exactly one of `post_id` or `subchannel_id` is present.
- `lifecycle_state`: `text`; `active`, `ending`, or `ended`.
- `created_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `ended_at`, `created_at`, `updated_at`: `timestamptz`; `ended_at` is nullable.
- `version`: `bigint`.

### `collaboration_documents`

- `collaboration_session_id`: `uuid_v7`; primary key and foreign key to `collaboration_sessions.id`.
- `yjs_state`: `bytea`.
- `text_projection`: `text`.
- `persisted_at`: `timestamptz`.
- `persistence_revision`: `bigint`.

### `collaboration_connection_tickets`

- `id`: `uuid_v7`; primary key.
- `token_hash`: `bytea`; unique.
- `collaboration_session_id`: `uuid_v7`.
- `course_id`: `uuid_v7`; with `collaboration_session_id`, foreign key to `collaboration_sessions(course_id, id)`.
- `user_id`: `uuid_v7`.
- `auth_session_id`: `uuid_v7`; with `user_id`, foreign key to `sessions(id, user_id)`.
- `permission`: `text`; `read` or `write`.
- `issued_at`, `expires_at`, `consumed_at`, `revoked_at`: `timestamptz`; final two are nullable.
