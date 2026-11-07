# Database schema

ChalkTalk uses PostgreSQL. IDs use `uuid_v7`. Mutable resources generally include `created_at`, `updated_at`, and `version`; a nullable `deleted_at` retains a tombstone where needed. `pg_trgm` supports fuzzy matching. For extracted resource text and its full-text index, see [`course_file_texts`](#course_file_texts-resource-text-extraction).

## Migrations

### `schema_migrations`

- `name`: `text`; primary key, the migration's full filename. Filenames rather than numeric prefixes identify migrations, so two files may share a number.
- `applied_at`: `timestamptz`.

## Identity and access

### `organizations`

- `id`: `uuid_v7`; primary key.
- `domain`: `varchar(253)`; unique exact school domain, stored normalized (trimmed and lowercased).
- `name`: `varchar(200)`; for organizations generated at signup, the normalized domain truncated to 200 characters for display. The full domain remains in `domain`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `users`

- `id`: `uuid_v7`; primary key.
- `organization_id`: `uuid_v7`; foreign key to `organizations.id`.
- `email`: `varchar(320)`; unique while active and stored normalized (trimmed and lowercased).
- `display_name`: `varchar(100)`.
- `password_hash`: `text`.
- `deleted_at`: `timestamptz`, nullable.
- `notification_emails`: `boolean`, default false; legacy account activity-email preference used to backfill per-course membership choices. It no longer controls delivery.
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
- `frozen_email`: nullable `jsonb`; versioned exact email payload (including base64-encoded inline images and MIME bytes), original provider, recipient address, course name, item-title and body hashes, and IDs of all represented images, including linked images. Committed before the first provider handoff, reused with identical MIME bytes on retries, and cleared on send or cancellation. Retries cancel rather than recompose if the recipient address, eligibility, course name, or any included item title/body/access changes, or a represented image is deleted.

For delivery and visibility behavior, see the [daily course email digest](api/daily-course-email-digest.md).

Digest scheduling scans from the day after the cursor through yesterday (inclusive), using partial `created_at` indexes on visible posts, undeleted answers, and undeleted followups before grouping activity by UTC day.

### `digest_schedule_state`

- `singleton`: fixed `true` primary key.
- `last_scanned_date`: `date`; most recent UTC activity date considered for outbox generation. The migration initializes it to the UTC day before deployment, making the deployment day the first eligible activity date. The scheduler locks and advances this row in the same transaction as the outbox insert, so concurrent replicas and restarts agree on catch-up progress.

### `jobs`

- `id`: `uuid_v7`; primary key.
- `kind`: `varchar(100)`.
- `payload`: `jsonb`.
- `status`: `text`; `queued`, `running`, `succeeded`, `dead`, or `canceled` (terminal only for invalidated email jobs).
- `deduplication_key`: `text`, nullable.
- `attempts`, `max_attempts`: `integer`.
- `available_at`, `locked_until`, `finished_at`, `created_at`, `updated_at`: `timestamptz`; lock and completion times are nullable.
- `locked_by`, `last_error`: `text`, nullable.
- `frozen_email`: nullable `jsonb`; versioned queued email payload (exact MIME bytes for SMTP or stable message and attachment bytes for Resend), original provider, and current-content guard. It commits before the first provider handoff, is retried with the same provider payload, and is cleared on success, cancellation, or terminal provider failure. Current address, membership, preference, title and body content, course status, and included actor or sender identities are rechecked before each attempt; a provider change cancels instead of switching transports; the frozen payload is not authorization to send. Cancellation atomically clears the snapshot and claim and records a non-sensitive reason, without a success metric.
- `delete_course` jobs remove a course and its dependent content. `send_question_duplicate_email` jobs use a `source-post-id:source-version` deduplication key and a payload containing source post ID, canonical post ID, acting staff user ID, and role. For notification behavior, see [Update post](api/posts.md#updatePost). `publish_scheduled_announcement` jobs use a `post-id:scheduled-for` deduplication key, a payload containing the post ID and the scheduled time, and `available_at` set to that time; the worker publishes only if the post is still scheduled for exactly that time. `send_notification_email` jobs, queued for recipients who opted in to activity emails and never for announcements, use the notification ID as deduplication key and a payload containing it. New answer/followup/reply jobs also carry optional `responseKind` (`answer` or `followup`) and `responseId` fields so the worker can recheck and link the current response; older payloads without those fields remain valid. `send_announcement_email` jobs use a `post-id:recipient-user-id` deduplication key and a payload containing the post ID and recipient user ID. `extract_file_text` jobs use a `file:<file-id>` deduplication key and a `{ fileId }` payload, get `max_attempts` 3, and are claimed only by the worker's extraction lane (see `course_file_texts`). For time limits, retries and the shutdown, lease-loss and object-store outage exceptions, see [the extraction lane design](../openspec/changes/add-resource-text-extraction/design.md#3-a-dedicated-extraction-lane-with-a-heartbeat-lease). `send_collaboration_invitation_email` jobs use a `session-id:invitee-user-id:participant-created-at-ms` deduplication key and a payload containing the session ID, invitee user ID, and inviter user ID; see [Invite participant](api/collaboration-sessions.md#inviteCollaborationParticipant).
- `generate_searchable_pdf` jobs use a `searchable-pdf:<fileId>:<generation>` deduplication key and a `{ fileId, generation }` payload, get `max_attempts` 3, and run only in the OCR-ready extraction lane. Current generation, active revision and lease checks fence publication. Reaching the 15-minute generation deadline fails permanently; an authorized reader can request a fresh generation.
- `delete_searchable_pdf` jobs use a `searchable-pdf-delete:<objectKey>` deduplication key and a `{ objectKey, fileId? }` payload. They run in the general lane, lock the source file when present, and delete only keys that no ready copy references. Storage failures use the worker's bounded retry/backoff policy; queued cleanup preserves the key before metadata is removed.
- No scheduled cleanup removes finished job rows; they currently remain in this table.

## Courses and membership

### `courses`

- `id`: `uuid_v7`; primary key.
- `organization_id`: `uuid_v7`; foreign key to `organizations.id`.
- `created_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `name`: `varchar(200)`.
- `status`: `text`; `active`, `archived`, or `deleting`.
- `allow_anonymous_posting`, `allow_private_posting`, `allow_followup_resolution`: non-null booleans, default `true`; instructor-managed policy for future discussion actions. Existing content is not rewritten when a switch changes.
- `join_code`: `char(8)`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.

### `course_memberships`

- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `(course_id, user_id)`: composite primary key; no separate membership `id` column is stored. The API derives a stable public ID from this pair.
- `incarnation`: immutable random `uuid`, non-null; assigned on insert and backfilled for existing memberships. This distinguishes leave/rejoin cycles in membership ETags.
- `role`: `text`; `student`, `ta`, or `instructor`.
- `created_at`, `updated_at`: `timestamptz`.
- `version`: `bigint`.
- `activity_emails`: `boolean`, default false; per-course activity email choice. Existing memberships inherit the legacy account choice.
- `announcement_emails`, `digest_emails`: `boolean`, default true; independent per-course email choices. Delivery rechecks them at send time.

Account deletion locks each affected `courses` row before testing instructor cardinality. Any future writer that adds, removes, or changes an instructor membership must lock the same course row first; this shared protocol prevents a concurrent mutation from deleting a course's final instructor.

### `course_information`

- `course_id`: `uuid_v7`; primary key and foreign key to `courses.id` with cascade deletion.
- `description_markdown`: `text`; at most 50,000 characters, defaults to empty.
- `website`: `text`, nullable; at most 2048 characters.
- `syllabus_file_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `course_files`.
- `version`: `integer`; positive revision. A course without a row reads as version 1.
- `updated_at`: `timestamptz`.

### `course_staff_profiles`

- `course_id`, `user_id`: `uuid_v7`; primary key and foreign key to `course_memberships` with cascade deletion.
- `contact`, `location`, `office_hours`: `text`; each at most 2000 characters, defaulting to empty.
- `version`: `integer`; positive revision.
- `updated_at`: `timestamptz`.

## Posts, answers, and polls

### `post_drafts`

- `(course_id,user_id)`: composite primary key and foreign key to `course_memberships(course_id,user_id)` with `ON DELETE CASCADE`; there is at most one draft per current member per course.
- `content`: nullable JSONB object of validated partial new-post text and metadata, never attachments. NULL is a content-free revision marker after discard or publication, not a visible draft.
- `created_at`, `updated_at`: `timestamptz`; saved content has no expiry.
- `version`: nonnegative `bigint`, starting at 0 and incremented on every save, discard, and successful publication; `If-Match` prevents a stale device from recreating cleared content.

### `posts`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`.
- `author_user_id`: `uuid_v7`, nullable; foreign key to `users.id`.
- `folder_id`: `uuid`, nullable; with `course_id`, foreign key to `post_folders(course_id, id)`. Null means Unfiled. Deleting a folder clears this value and advances affected post versions.
- `(course_id, id)`: unique key used by same-course foreign keys.
- `type`: `text`; `question`, `note`, or `poll`.
- `title`: `varchar(200)`, nullable.
- `body_markdown`: `text`, nullable.
- `anonymous`, `pinned`: `boolean`.
- `discussion_locked`: `boolean NOT NULL DEFAULT false`; staff-controlled participation gate. Lock changes advance `version` and `updated_at`, not `last_activity_at`. New answers, followups, replies and all vote changes acquire the parent post row lock and fail while set.
- `announcement`: `boolean`, default false; only a non-anonymous note can be an announcement (`posts_announcement_check`). Announcements are created pinned by staff and emailed to current members who enable announcement emails; see [Create post](api/posts.md#createPost).
- `private`: `boolean`, default false; readable only by the author and course staff. Announcements and polls are never private (`posts_private_check`), and a private post can become public but never the reverse. A partial index on `(course_id, last_activity_at DESC)` for active private posts serves the private filter.
- `duplicate_of_post_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `posts(course_id, id)`.
- `duplicate_status`: `text`; `none`, `suggested`, or `confirmed`.
- Confirming a duplicate retains the original title and body in this row. Application reads exclude confirmed rows from ordinary lists and search, redirect direct links to the active canonical row, and expose only restricted title/target metadata to staff review. Unmerge restores the retained content. The application blocks deleting or merging a canonical row while confirmed rows refer to it; this lifecycle rule is not enforced by the foreign key alone.
- `last_activity_at`, `deleted_at`, `created_at`, `updated_at`: `timestamptz`; `deleted_at` is nullable.
- `version`: `bigint`.
- `search_vector`: generated `tsvector`, nullable.
- The `(course_id, created_at DESC, id DESC)` index supports new-post counting by creation time; see [New-post notice endpoint](api/posts.md#new-post-notice-endpoint).
- Active post titles and bodies have separate GIN trigram indexes (`posts_title_trgm_idx`, `posts_body_trgm_idx`) for ordinary fuzzy search. Migration `007_post_fuzzy_search.sql` installs `pg_trgm` in `public` and qualifies its functions, operators, and operator classes because API tests use isolated schemas in their search paths. The extension must be available and installable in each deployment database; the migration fails if it is not.

### Optional semantic post embeddings

Ordinary migration `014_semantic_post_catchup.sql` creates `semantic_post_catchup` in PostgreSQL without pgvector. Create, title/body edit, and unmerge transactions insert generation-scoped rows when enqueue is unavailable or fails; no-key writes insert rows for recently registered generations. Delete and confirmed-duplicate merge transactions remove all rows for the post. The worker reads pending rows independently of the timestamp-based legacy backfill cursor and deletes each row only in the transaction that stores current-revision vectors. Failed or unavailable optional enqueue never rolls back the post write. Migration `027_semantic_initial_backfill_completion.sql` records per-generation completion and scan epoch; semantic ranking remains disabled until that scan and current-revision jobs finish. An expired generation lease starts a new scan epoch so existing workers discard their old cursors.

Migration `015_semantic_catchup_generation.sql` adds generation ownership. Migration `016_semantic_catchup_ownership.sql` makes `(post_id, generation)` the primary key, with `post_id` cascading on deletion. Migration `017_semantic_generation_registry.sql` registers recently active model generations in ordinary PostgreSQL and converts previous empty-generation rows into generation-specific work. A no-key post write creates separate catch-up rows for generations seen in the last day; first registration and lease refresh serialize with no-key writes so an in-flight commit cannot be missed. An active generation refreshes its registration at most once per minute rather than writing on every search, enqueue, or backfill poll. A generation first registered later starts its own initial full backfill. Workers claim only matching-generation jobs and clear only their generation's row after storing current-revision vectors. Semantic health checks consider only the current generation, not abandoned old-generation rows. The one-day active window prevents fanout to every historical model; a generation whose registration expires restarts backfill when it becomes active again.

The ordinary migrations and PostgreSQL startup do not require pgvector. An operator that enables semantic post search runs `npm run migrate:semantic --workspace=@chalktalk/api` against a pgvector-capable database. This explicit migration installs `vector` in `public` and creates `post_embeddings` without changing authoritative post content.

- `(post_id, generation, chunk_ordinal)`: primary key; `post_id` references `posts(id)` with cascading deletion.
- `source_revision`: SHA-256 digest of the post title and body. A changed title or body makes old vectors ineligible immediately, before the worker refreshes them.
- `embedding`: pgvector value for one bounded title/body chunk. `generation` identifies the configured endpoint/model so vectors from different generations are never compared.
- The worker backfills active questions and notes (never polls) and stores a post's chunks only if its content revision remains unchanged after provider calls. Search joins current course and post visibility before ranking or pagination; deleted posts and confirmed duplicates do not yield semantic candidates.

### `semantic_embedding_generations`

Tracks each embedding generation used by optional semantic search.

- `generation`: `text`; primary key.
- `last_seen_at`: `timestamptz`.
- `initial_backfill_complete`: `boolean`.
- `backfill_epoch`: `bigint`.

### `post_follows`

- `post_id`, `course_id`, `user_id`: `uuid_v7`; primary key `(post_id, user_id)`. `(course_id, post_id)` references the post and `(course_id, user_id)` the course membership, both cascading, so leaving a course drops its follows.
- `following`: `boolean`. `false` records an explicit unfollow, which automatic follows never overwrite.
- `created_at`, `updated_at`: `timestamptz`.

### `notifications`

- `id`: `uuid_v7`; primary key.
- `user_id`: `uuid_v7`; the recipient.
- `course_id`, `post_id`: `uuid_v7`; `(course_id, post_id)` references the post, cascading.
- `kind`: `text`; `answer_created`, `answer_edited`, `answer_endorsed`, `followup_created`, `reply_created`, `announcement`, `post_published` (staff made the recipient's private post public), or `mentioned` (the recipient was mentioned in the content).
- `actor_user_id`: `uuid_v7`, nullable; who acted. `actor_anonymous`: `boolean`; the actor posted anonymously, so students see "Anonymous".
- `created_at`: `timestamptz`. `read_at`: `timestamptz`, nullable.
- Indexes: `(user_id, created_at DESC, id DESC)` for listing, partial `(user_id)` where unread for counts, and `(post_id, user_id)` for marking the notifications of an opened post read.
- Rows are written by the same transaction as the activity; see the [notifications reference](api/notifications.md).

### `post_reads`

- `post_id`, `user_id`: `uuid_v7`; primary key; cascades with the post.
- `read_at`: `timestamptz`; when the user last opened the post or acted on it.

### `course_read_marks`

- `course_id`, `user_id`: `uuid_v7`; primary key; references the course membership, cascading.
- `read_before`: `timestamptz`; set by Mark all read. A post is unread when its `last_activity_at` is later than both this and the user's `post_reads.read_at`.

### `post_folders`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`; `(course_id, id)` is unique for same-course post references.
- `name`: `varchar(64)`, trimmed and 1–64 Unicode code points; unique per course ignoring case, displayed alphabetically.
- `created_at`: `timestamptz`.

Folder names are staff-managed and independent of tags. Existing posts default to Unfiled. Folder deletion clears their `folder_id` in the same transaction.

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
- `position`: `smallint`, 0–9; unique with `post_id`, giving the options their order.
- `label`: `varchar(200)`, nonempty.
- Options are fixed at creation and deleted with their post.

### `poll_votes`

- `course_id`: `uuid_v7`.
- `post_id`: `uuid_v7`; with `course_id`, foreign key to `posts(course_id, id)`; part of the primary key.
- `user_id`: `uuid_v7`; foreign key to `users.id`; part of the primary key.
- `option_id`: `uuid_v7`; with `course_id` and `post_id`, foreign key to `poll_options(course_id, post_id, id)`; part of the primary key.
- `created_at`, `updated_at`: `timestamptz`; `updated_at` changes when a member changes their vote.
- One row per selected option, with a `(post_id, user_id, option_id)` primary key. A member's rows form one editable ballot. Votes are deleted with their poll. Counts and ballot totals are visible to staff and to students after release; identities and choice mappings are never exposed.

### `poll_settings`

- `post_id`: primary key and foreign key to `posts.id`; one settings row per poll, deleted with the post. Existing polls were backfilled with single-select, live results. A missing row is an API invariant failure, not a live/open fallback.
- `selection_mode`: `single` or `multiple`; `max_selections` is one for single-select and 2–10 for multi-select (the service also bounds it by the number of options).
- `closes_at`: optional deadline; `closed_at`: optional manual close time. An elapsed deadline closes the poll even without a worker.
- `release_mode`: `live` for existing and basic single-select polls, `manual`, or `automatic` on close. New multi-select polls require `manual` or `automatic` at the API boundary. `results_released_at` records an irreversible release; automatic release at the deadline is also inferred before the next write materializes it.
- `explanation`: optional staff-authored text (up to 10,000 characters), exposed to students only with released results.

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
- `resolved_at`: `timestamptz`, nullable; when staff or the question's author resolved the discussion. Only root followups can be resolved (`followups_resolution_root_check`), and a new reply anywhere in the discussion clears it.
- `resolved_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`, set exactly when `resolved_at` is (`followups_resolution_pair_check`).

Direct followups are indexed by `(post_id, parent_followup_id, created_at, id)`. Deleted roots or replies with children retain a bodyless tombstone; deleted leaves are excluded from ordinary reads. A partial index on `(post_id)` covers active, unresolved root followups for question counts and the unresolved filter.

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

> **Not built.** The tables in this section do not exist, pending a team decision on knowledge surfacing. They record the planned design. The implemented daily email digest uses `digest_outbox` and `digest_schedule_state`.

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

### `course_files`

Immutable uploaded files, used by the resource catalog and by course syllabi.

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id` with cascade deletion. `(course_id, id)` is unique for same-course foreign keys.
- `uploaded_by_user_id`: `uuid_v7`, nullable; foreign key to `users.id`, SET NULL on user deletion.
- `object_key`: `text`; unique object-store key. Not exposed by the API.
- `file_name`, `media_type`: `text`.
- `size_bytes`: `bigint`; 1 to 104,857,600.
- `checksum_sha256`: `bytea`; 32 bytes.
- `created_at`: `timestamptz`; defaults to `clock_timestamp()`.
- `deleted_at`: `timestamptz`, nullable; set when the file is hidden, after which a `delete_course_file` job removes its bytes.

### `course_resource_catalogs`

- `course_id`: `uuid_v7`; primary key and foreign key to `courses.id` with cascade deletion.
- `version`: `integer`; catalog revision, incremented by every catalog change and used for the list ETag and ordering `If-Match`.

### `course_resource_sections`

- `id`: `uuid_v7`; primary key. `(course_id, id)` is unique for same-course foreign keys.
- `course_id`: `uuid_v7`; foreign key to `courses.id` with cascade deletion.
- `title`: `text`; trimmed nonblank, at most 200 characters.
- `visibility`: `text`; `class` or `staff`.
- `position`: nonnegative `integer`; instructor-chosen order.
- `version`: `integer`; positive revision.

### `course_resources`

- `id`: `uuid_v7`; stable resource identity and primary key. `(course_id, id)` is unique.
- `course_id`: `uuid_v7`; foreign key to `courses.id` with cascade deletion.
- `section_id`: `uuid_v7`, nullable; with `course_id`, foreign key to `course_resource_sections`. Null means ungrouped.
- `title`: `text`; trimmed nonblank, at most 200 characters.
- `visibility`: `text`; `class` or `staff`. A staff-only section restricts its items regardless of this value.
- `position`: nonnegative `integer`.
- `active_revision_id`: `uuid_v7`; with `id`, foreign key to `course_resource_revisions(resource_id, id)`.
- `version`: `integer`; positive revision.
- `created_at`: `timestamptz`; `deleted_at`: `timestamptz`, nullable logical deletion.

### `course_resource_revisions`

- `id`: `uuid_v7`; primary key. `(resource_id, id)` is unique.
- `resource_id`, `course_id`: `uuid_v7`; foreign key to `course_resources(course_id, id)` with cascade deletion.
- `kind`: `text`; `upload` or `link`.
- `file_id`: `uuid_v7`, unique and nullable; with `course_id`, foreign key to `course_files`. Required for `upload`, null for `link`.
- `url`: `text`, nullable; absolute HTTP(S), at most 2048 characters. Required for `link`, null for `upload`.
- `created_at`: `timestamptz`.

### `course_resource_links` (legacy flat named links)

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id` with cascade deletion.
- `title`: `text`; trimmed nonblank title, at most 200 Unicode code points (database check on trimmed length).
- `url`: `text`; absolute HTTP(S), at most 2048 Unicode code points; API rejects credentials, missing host, raw Unicode whitespace (including surrounding whitespace), C0/C1 controls and backslashes before parsing. Database checks length and HTTP(S) prefix. Never fetched by the server.
- `created_by_user_id`: nullable `uuid_v7`; foreign key to `users.id`, SET NULL on user deletion. Not exposed in public resource metadata.
- `created_at`: `timestamptz`; defaults to `clock_timestamp()`.
- `(course_id, created_at DESC, id DESC)` indexes the legacy list. Migration [`029_organized_course_resources.sql`](../database/migrations/029_organized_course_resources.sql) backfills these links into the current catalog's resources and revisions; current catalog reads do not query this legacy table. For link creation and idempotency, see the [resource API reference](api/resources.md#createResource).

### `course_file_texts` (resource text extraction)

- `file_id`: `uuid_v7`; primary key. With `course_id`, foreign key to `course_files(course_id, id)` with cascade deletion, so course deletion removes extracted text.
- `course_id`: `uuid_v7`.
- `status`: `text`; `pending`, `ready`, `failed`, or `unsupported`. Text is non-null exactly when `ready`; `failed` and `unsupported` require `failure_code`.
- `text`: `text`, nullable; normalized extracted text of at most 500,000 Unicode code points. CRLF and CR become newline; C0 and C1 controls other than newline, and U+E000/U+E001, become spaces. Tabs and Unicode space runs collapse to one space; spaces beside newlines are removed, runs of three or more newlines collapse to two, and surrounding whitespace is trimmed.
- `truncated`: `boolean`; true when an extraction or storage limit cuts the text short, including the OCR page cap, the character cap, the final attempt's OCR deadline, skipped PPTX slides or speaker notes above the 64 MiB uncompressed XML-part limit, or additional shortening to fit PostgreSQL's tsvector size limit. A page with usable selectable text that the OCR cap or deadline skips keeps that text and does not set this flag only when it is the only page in the file that needed OCR. Skipped unrelated archive entries do not affect this flag; skipping every wanted PPTX part produces empty, truncated text. A missing or oversized DOCX body instead fails extraction as a damaged file.
- `progress_phase`: nullable `text`; queued, preparing, ocr or saving (migration 059). A legacy pending row with no progress projects queued. Terminal rows require all progress columns null.
- `progress_completed_pages`, `progress_total_pages`: nullable integers, both present only for OCR; positive total and completed between zero and total. Counts describe OCR work pages in the inspected portion before applying caps, excluding text-only pages.
- `progress_attempt`: nullable positive integer, internal extraction attempt fence. Preparing/saving require an attempt and null counts; OCR requires an attempt and both counts; queued requires null counts and attempt. Shape CHECK rejects all other combinations. A null phase requires all other progress fields null.
- `failure_code`: `text`, nullable, 1–100 characters; internal only and never exposed by the API.
- `extracted_at`, `created_at`, `updated_at`: `timestamptz`; `extracted_at` is nullable.
- `search_vector`: generated `tsvector` (`english` configuration) when `ready`, with a GIN index. `<` and `>` are translated to private-use stand-ins (U+E000, U+E001, which normalization removes from source text) before parsing, because PostgreSQL's default parser would otherwise skip markup-like text such as `<script>…</script>`; snippets use the same translation and map it back.

A `pending` row is inserted for each file that becomes the active revision of a catalog resource, in the same transaction as its `extract_file_text` job. Rows are keyed by immutable file, so search reads them only through the live resource's active revision and never returns text from removed resources or replaced files.

Publishing `ready`, `failed` or `unsupported` requires the current job owner, attempt and unexpired lease in the same transaction as the text update. Progress writes use the same job fence, check the active upload revision, and are awaited after inspection and each OCR page. Retries reset progress, terminal publication clears it, and metadata masks running progress when its attempt is no longer live. Progress never changes catalog versions or ETags. Publication locks the job against takeover and rolls back if the lease expires while writing; text-size reduction retries remain within that transaction.

The `resources` and `resource_regions` structures below are deferred; they are distinct from the implemented course-scoped catalog defined in [`029_organized_course_resources.sql`](../database/migrations/029_organized_course_resources.sql).

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

## Public course Threads

Threads are public topic boards managed by course staff. Conversations are separate chronological message streams inside a board, not subchannels or team rosters. The tables below are introduced by `053_public_course_threads.sql`; there is no legacy Channels data to convert.

### `thread_boards`

- `id`: `uuid`; primary key. `(course_id, id)` is unique.
- `course_id`: `uuid`; foreign key to `courses.id`, deleted with the course.
- `title`: `text`; trimmed length 1–200.
- `version`: positive `integer`; used for conditional rename/deletion.
- `created_at`, `updated_at`, `deleted_at`: `timestamptz`; `deleted_at` is nullable. Soft deletion immediately hides the board and all descendants while file cleanup is queued.
- Live boards are indexed by course and creation order.

### `thread_conversations`

- `id`: `uuid`; primary key. `(course_id, board_id, id)` is unique.
- `course_id`, `board_id`: `uuid`; together reference `thread_boards(course_id, id)`, cascading on course deletion.
- `created_by_user_id`: nullable `uuid` referencing the starter; survives opening-message deletion so the starter may still delete the conversation.
- `version`: positive `integer`; advances on reply, message edit/delete, and attachment changes to protect whole-conversation deletion.
- `next_message_ordinal`: positive `bigint`; allocates chronological message order under a conversation-row lock.
- `created_at`, `updated_at`: `timestamptz`; recent conversations are indexed per board.
- Whole-conversation deletion cascades its messages, watches, read state, attachment metadata, and notification cards after queuing object-cleanup jobs and scrubbing idempotency replay bodies.

### `thread_messages`

- `id`: `uuid`; primary key. `(course_id, id)` and `(conversation_id, ordinal)` are unique.
- `course_id`, `board_id`, `conversation_id`: `uuid`; together reference the owning conversation.
- `ordinal`: positive `bigint`; unique within the conversation. Ordinal 1 is the required opening message.
- `author_user_id`: nullable `uuid`; foreign key to `users.id` with `ON DELETE SET NULL`.
- `author_role_at_posting`: `student`, `ta`, or `instructor`; immutable permission snapshot for staff moderation.
- `body_markdown`: `text`, at most 100,000 characters; scrubbed when deleted.
- `version`: positive `integer`; stale edits and deletes fail their ETag precondition.
- `created_at`, `updated_at`, `deleted_at`: `timestamptz`; `deleted_at` is nullable. A deleted opening message remains as an authorless, bodyless placeholder without losing replies.

### `thread_watches` and `thread_message_reads`

- `thread_watches` is keyed by `(conversation_id, user_id)` and references current course membership, so leaving a course removes the watch. `notices_enabled` controls reply notification cards, not unread counting or access; `created_at` and `updated_at` record watch changes.
- `thread_message_reads` is keyed by `(message_id, user_id)` with a `read_at` timestamp. Exact loaded-message IDs are marked read; a single last-seen timestamp cannot incorrectly clear unloaded or concurrent messages.

### `thread_attachments`

- `id`: `uuid`; primary key. `course_id`, `board_id`, `conversation_id`, and `message_id` identify the parent; `(course_id, message_id)` references the message.
- `object_key`: unique `text`; `file_name`, `media_type`: `text`; `size_bytes`: positive `bigint`, maximum 100 MiB; `checksum_sha256`: 32-byte digest.
- `created_at`, `deleted_at`: `timestamptz`; `deleted_at` is nullable. Deleted messages, boards, and attachments deny new downloads before object cleanup completes.

### `thread_notifications`

- `id`: `uuid`; primary key. `course_id` and `recipient_user_id` reference a current membership; `conversation_id`, `message_id`, and nullable `actor_user_id` identify the reply.
- `created_at`, `read_at`: `timestamptz`; `read_at` is nullable. Recent and unread recipient indexes support the existing bell projection. No Thread email is generated.

### `thread_course_counters` and `thread_changes`

- `thread_course_counters` has one row per course and a nonnegative committed `sequence`. Updating it under a row lock in the same transaction as each Thread mutation gives catch-up a course-local commit order.
- `thread_changes` is keyed by `(course_id, sequence)` and records `board_id`, `kind`, `entity_id`, and `created_at`. WebSocket signals contain identifiers and sequence only; clients fetch authorized changes through REST.

## Collaboration

Live sessions are private, course-scoped shared code and whiteboard documents, independent of posts and Threads. Migration preserves existing session IDs, document state, participant rows, and permissions while dropping the post association. Post edits, merges, and deletion do not end or delete sessions.

### `collaboration_sessions`

- `id`: `uuid_v7`; primary key.
- `course_id`: `uuid_v7`; foreign key to `courses.id`, deleted with the course.
- `(course_id, id)`: unique key used by course-bound participants and tickets.
- `title`: `text`; trimmed, 1–120 characters.
- `language`: `text`; one of `plaintext`, `python`, `java`, `c`, `cpp`, `javascript`, `typescript`, or `sql`; defaults to `plaintext`.
- `lifecycle_state`: `text`; `active`, `ending`, or `ended`. `ending` is held only while the collaboration server persists the final text.
- `created_by_user_id`: `uuid_v7`; foreign key to `users.id`.
- `ended_at`, `created_at`, `updated_at`: `timestamptz`; `ended_at` is non-null exactly when `lifecycle_state` is `ended`.
- `version`: `bigint`; positive revision used for the session `ETag`.
- `final_snapshot_confirmed`: `boolean NOT NULL DEFAULT false`; stored as `false` while active or ending and when completeness cannot be proven (including possible in-flight edits), finalization fails, or the session ended before migration. It is `true` only when all authorized edits are proven durable. The API projects `null` for active or ending sessions; ended sessions with `false` show a last-saved warning.
- `last_active_at`: `timestamptz`; when the session last had a connected participant, kept current by the collaboration server while anyone is connected and when the last connection closes. Active sessions idle past `COLLABORATION_IDLE_END_MINUTES` end automatically.
- Indexes: `(course_id, created_at DESC, id DESC)` for listing; partial `(course_id)` where the session is not ended, for lifecycle sweeps; partial `(last_active_at)` where the session is active, for idle ending. Participant visibility is applied before pagination.

### `collaboration_documents`

- `collaboration_session_id`: `uuid_v7`; primary key and foreign key to `collaboration_sessions.id`, deleted with the session.
- `yjs_state`: `bytea`; the complete encoded Yjs document state.
- `text_projection`: `text`; `Y.Text('content').toString()`, at most 200,000 characters.
- `whiteboard_projection`: `jsonb`; a JSON array, default `[]`. The non-deleted elements of `Y.Map('whiteboard')` in drawing order (fractional `index`, then `id`), written in the same statement as `yjs_state`.
- `persisted_at`: `timestamptz`.
- `persistence_revision`: `bigint`; non-negative, incremented on each store.

### `collaboration_participants`

- `collaboration_session_id`, `course_id`, `user_id`: `uuid_v7`; primary key `(collaboration_session_id, user_id)`.
- `(course_id, collaboration_session_id)`: foreign key to `collaboration_sessions(course_id, id)`, deleted with the session.
- `(course_id, user_id)`: foreign key to `course_memberships(course_id, user_id)`, deleted with the membership, so leaving or being removed from a course removes session access.
- `invited_by_user_id`: `uuid_v7`; foreign key to `users.id`. The creator's row names the creator.
- `permission`: `text`; `edit` (default) or `view`. Viewers, including staff, get `read` connection tickets; the creator's row is always `edit`.
- `created_at`: `timestamptz`.
- Index: `(course_id, user_id)`.

No staff access override exists: current course membership and an explicit participant row are required for session discovery, details, snapshot, ticket, and WebSocket access. Any participant may invite a current course member. Only the creator or participating current staff may rename/end a session or remove an invitee. The creator cannot be removed. Creator course departure ends an active session before membership deletion; the final persisted snapshot remains available to remaining participants.

### `collaboration_connection_tickets`

- `id`: `uuid_v7`; primary key.
- `token_hash`: `bytea`; unique SHA-256 hash of the one-use ticket, exactly 32 bytes. The ticket itself is never stored.
- `collaboration_session_id`, `course_id`: `uuid_v7`; foreign key to `collaboration_sessions(course_id, id)`, deleted with the session.
- `user_id`: `uuid_v7`; foreign key to `users.id`.
- `auth_session_id`: `uuid_v7`; foreign key to `sessions.id`, deleted with the login session.
- `permission`: `text`; `read` or `write`.
- `issued_at`, `expires_at`, `consumed_at`, `revoked_at`: `timestamptz`; the final two are nullable, and `expires_at` is after `issued_at`.
- Index: partial `(collaboration_session_id, user_id)` over unused tickets, for revocation.

### Searchable PDF copies

`course_file_searchable_pdfs` (migrations 057 and 058) belongs to immutable `course_files` via `(course_id,file_id)` cascading FK. It stores a generation UUID and independent pending/ready/failed state. Only ready rows carry private unique `object_key`, positive `size_bytes` (at most 100 MiB) and `page_count`; both size and page count are required when ready and both must be null otherwise (migration 058 enforces the non-ready side). Failed rows carry a bounded internal failure code. Timestamps record creation/update. Absence means not requested. Generation runs in the OCR-ready extraction lane with a lease and generation fence. File retirement/course deletion queues derived storage cleanup before cascading metadata; generation losers delete or durably queue orphan objects. Existing original files, resource versions and `course_file_texts` are untouched.
