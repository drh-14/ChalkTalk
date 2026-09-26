# Database schema

ChalkTalk uses PostgreSQL. IDs use `uuid_v7`. Mutable resources generally include `created_at`, `updated_at`, and `version`; a nullable `deleted_at` retains a tombstone where needed. `pg_trgm` supports fuzzy matching, and full-text indexes support post and resource-region search.

## Identity and access

### `organizations`

- `id`: `uuid_v7`; primary key.
- `canonical_domain`: `varchar(253)`; unique normalized school domain.
- `name`: `varchar(200)`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `users`

- `id`: `uuid_v7`; primary key.
- `organization_id`: `uuid_v7`; foreign key to `organizations.id`.
- `email_normalized`: `varchar(320)`; unique while active.
- `display_name`: `varchar(100)`.
- `password_hash`: `text`.
- `deleted_at`: `timestamptz`, nullable.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `email_verification_tokens`

- `id`: `uuid_v7`; primary key.
- `email_normalized`: `varchar(320)`.
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
- `authenticated_at`, `expires_at`, `revoked_at`, `created_at`: `timestamptz`; `revoked_at` is nullable.

### `idempotency_records`

- `id`: `uuid_v7`; primary key.
- `scope`: `text`.
- `operation`, `idempotency_key`: `varchar(255)`.
- `(scope, operation, idempotency_key)`: unique key.
- `request_hash`: `bytea`.
- `state`: `text`; `processing` or `completed`.
- `response_status`: `integer`, nullable.
- `response_headers`, `response_body`: `jsonb`, nullable.
- `created_at`, `updated_at`, `expires_at`: `timestamptz`.

### `rate_limit_buckets`

- `action`: `varchar(100)`; part of the primary key.
- `subject_hash`: `bytea`; part of the primary key.
- `window_start`: `timestamptz`; part of the primary key.
- `request_count`: `integer`.
- `expires_at`: `timestamptz`.

## Background work

### `jobs`

- `id`: `uuid_v7`; primary key.
- `kind`: `varchar(100)`.
- `payload`: `jsonb`.
- `status`: `text`; `queued`, `running`, `succeeded`, or `dead`.
- `deduplication_key`: `text`, nullable.
- `attempts`, `max_attempts`: `integer`.
- `available_at`, `locked_until`, `finished_at`, `created_at`, `updated_at`: `timestamptz`; lock and completion times are nullable.
- `locked_by`, `last_error`: `text`, nullable.

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

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(course_id, user_id)`: unique key.
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
- `tags`: `text[]`.
- `duplicate_of_post_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `posts(course_id, id)`.
- `duplicate_status`: `text`; `none`, `suggested`, or `confirmed`.
- `last_activity_at`, `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.
- `search_vector`: generated `tsvector`, nullable.

### `poll_options`

- `id`: `uuid_v7`; primary key.
- `post_id`: `uuid_v7`; foreign key to `posts.id`.
- `(post_id, id)`: unique key for poll-vote validation.
- `position`: `smallint`; unique with `post_id`.
- `label`: `varchar(200)`.

### `poll_votes`

- `post_id`: `uuid_v7`; foreign key to `posts.id`; part of the primary key.
- `user_id`: `uuid_v7`; foreign key to `users.id`; part of the primary key.
- `option_id`: `uuid_v7`; with `post_id`, foreign key to `poll_options(post_id, id)`.
- `created_at`, `updated_at`: `timestamptz`.

### `answers`

- `id`: `uuid_v7`; primary key.
- `post_id`: `uuid_v7`; foreign key to `posts.id`.
- `(post_id, id)`: unique key used by answer-specific relationships.
- `kind`: `text`; `student` or `staff`.
- `body_markdown`: `text`, nullable.
- `anonymous`: `boolean`.
- `endorsed_at`: `timestamptz`, nullable.
- `endorsed_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

### `answer_collaboration_documents`

- `answer_id`: `uuid_v7`; primary key and foreign key to `answers.id`.
- `yjs_state`: `bytea`.
- `lifecycle_state`: `text`; `active`, `finalizing`, or `closed`.
- `persisted_at`: `timestamptz`.
- `persistence_revision`: `bigint`.

### `answer_contribution_events`

- `id`: `uuid_v7`; primary key.
- `answer_id`: `uuid_v7`; foreign key to `answers.id`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `event_kind`: `text`; `created` or `edited`.
- `contributed_at`: `timestamptz`.

### `followups`

- `id`: `uuid_v7`; primary key.
- `answer_id`: `uuid_v7`; foreign key to `answers.id`.
- `(answer_id, id)`: unique key used by parent validation.
- `parent_followup_id`: `uuid_v7`, nullable; with `answer_id`, foreign key to `followups(answer_id, id)`.
- `body_markdown`: `text`, nullable.
- `author_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `anonymous`: `boolean`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.

### `attachments`

- `id`: `uuid_v7`; primary key.
- `post_id`: `uuid_v7`, nullable; foreign key to `posts.id`.
- `answer_id`: `uuid_v7`, nullable; foreign key to `answers.id`.
- `followup_id`: `uuid_v7`, nullable; foreign key to `followups.id`.
- Exactly one parent foreign key is present.
- `object_key`: `text`, nullable and unique when present.
- `original_filename`: `varchar(255)`.
- `media_type`, `status`: `text`.
- `size_bytes`: `bigint`.
- `checksum_sha256`: `bytea`.
- `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.

### `post_view_events`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `viewed_at`: `timestamptz`.

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
- `resource_id`: `uuid_v7`; foreign key to `resources.id`.
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
- `subchannel_id`: `uuid_v7`; foreign key to `subchannels.id`.
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

### `answer_collaboration_connection_tickets`

- `id`: `uuid_v7`; primary key.
- `token_hash`: `bytea`; unique.
- `answer_id`: `uuid_v7`; foreign key to `answers.id`.
- `user_id`: `uuid_v7`.
- `auth_session_id`: `uuid_v7`; with `user_id`, foreign key to `sessions(id, user_id)`.
- `permission`: `text`; always `write`.
- `issued_at`, `expires_at`, `consumed_at`, `revoked_at`: `timestamptz`; final two are nullable.
