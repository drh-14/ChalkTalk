# Design

## Context

- **Announcement creation.** `PostService.create` does everything for an announcement in one transaction: it inserts the post pinned, queues one `send_announcement_email` job per other member, and calls `recordActivity` with `kind: "announcement"`.
- **Jobs.** Jobs carry `available_at`, and the worker claims only jobs whose `available_at` has passed, so a future job is a timer.
- **Visibility.** `readablePost` and `canReadPost` (`apps/api/src/posts/visibility.ts`) are the single visibility rule used by every read path, including notifications, the digest, sessions, attachments, and the worker.

## Decisions

### D1. Schema (migration 029)

- Add `posts.scheduled_for timestamptz`, nullable, with `CHECK (scheduled_for IS NULL OR announcement)`.
- Add a partial index `(course_id) WHERE scheduled_for IS NOT NULL`.
- Add the job kind `publish_scheduled_announcement`, with payload `{ postId, scheduledFor }` and deduplication key `<postId>:<scheduledFor ISO>`. The worker's claim list adds it.

### D2. Visibility

`readablePost` becomes:

```sql
(${role} IN ('ta','instructor')
  OR (${post}.scheduled_for IS NULL
      AND (NOT ${post}.private OR ${post}.author_user_id = ${viewer})))
```

`canReadPost` changes to match. The digest's post queries add `AND p.scheduled_for IS NULL`, because the digest is shared by staff and students alike.

### D3. Announcing as a shared step

- `announce(db, { postId, courseId, actorId })` moves into `posts/announce.ts`. It queues the per-member emails and calls `recordActivity` with `kind: "announcement"`.
- `create` calls it immediately for an unscheduled announcement.
- A scheduled one instead records only the author's follow and read (through `recordActivity` with no `kind`) and inserts the publish job, with `available_at = scheduled_for`.

### D4. Publishing

`publish(db, postId, actorId)` runs one `UPDATE … SET scheduled_for = NULL, created_at = clock_timestamp(), last_activity_at = clock_timestamp(), updated_at = now(), version = version + 1`, then `announce`. It is used by:

- **The worker.** It locks the post and requires that `scheduled_for` equals the job's `scheduledFor`, the post is not deleted, and the course is active; otherwise it does nothing. The actor is the post's author.
- **`PATCH` with `scheduledFor: null`.** The actor is the caller.

Rescheduling updates `scheduled_for` and inserts a new job, which makes the old job stale, so the worker skips it. Deleting a post also leaves its job stale.

### D5. Validation

- `scheduledFor` must parse as an ISO date-time between `now() + 1 minute` and `now() + 365 days`, measured on the server.
- On create it requires `announcement: true`.
- On update it requires the post to be scheduled (`not_scheduled` otherwise).
- Every failure returns `422 schedule_invalid`.

### D6. Web

- **Composer.** When **Post as announcement** is checked, a **Publish** radio group (**Now** or **Later**) appears. **Later** shows a `datetime-local` input, defaulting to tomorrow at 9:00, converted from local time to UTC ISO.
- **Feed card.** A **Scheduled** status shows the short local date and time.
- **Post detail.** The notice reads "Scheduled to publish <local date and time>. Only staff can see it until then." It has **Publish now**, which asks for confirmation, and **Reschedule**, an inline `datetime-local` with **Save** and **Cancel**.

## Risks / Trade-offs

- **[The worker is down at the scheduled time]** → The job stays queued and publishes as soon as the worker returns, a little late but exactly once.
- **[Timezones]** → The browser converts local input to UTC, and everyone sees local times. The server only compares instants.
- **[The created time changes at publish]** → This is intentional, so feeds sort and the digest counts it as new on its publish day.

## Migration Plan

Migration 029 adds the column, the check, and the index. Rolling back first publishes or deletes the scheduled posts, then drops the column.
