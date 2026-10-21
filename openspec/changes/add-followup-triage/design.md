# Design

## Context

- **Threads.** Followups exist only on questions. A root followup has `parent_followup_id IS NULL`. Replies point at a parent, and nesting has no depth limit (`FollowupService.create(postId, userId, input, parentId)`).
- **Access.** `FollowupService.question()` loads the question with the caller's role and course status, and applies the private-post rule (`canReadPost`).
- **Revisions.** Followup edits use `If-Match` against `followups.version`, and post projections expose `lastActivityAt`, which drives feed order, unread markers, and notifications.

## Decisions

### D1. Schema (migration 027)

- Add `followups.resolved_at timestamptz` and `followups.resolved_by_user_id uuid REFERENCES users(id)`, both null by default, so existing discussions start unresolved.
- Add `CHECK (parent_followup_id IS NULL OR resolved_at IS NULL)`, so only roots can be resolved, and `CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL))`.
- Add a partial index `(post_id) WHERE parent_followup_id IS NULL AND deleted_at IS NULL AND resolved_at IS NULL` for the count and the filter.

### D2. Resolution routes

- `PUT` and `DELETE /api/v1/followups/{followupId}/resolution` call `FollowupService.setResolved(id, userId, resolved)` in one transaction:
  1. lock the followup, then load its question through `question()`, giving `404` if the followup is deleted or the question is not readable;
  2. return `409 course_archived` unless the course is active;
  3. return `422 not_a_discussion` for a reply;
  4. allow only staff and the question's author, otherwise `403 permission_denied`;
  5. `UPDATE followups SET resolved_at = CASE WHEN $resolved THEN coalesce(resolved_at, now()) END, resolved_by_user_id = …`. Neither `version` nor `updated_at` changes, and the post is untouched.
- The response is the projected followup, with `200`.
- `canResolve` uses the same rule: an active root followup in an active course, viewed by staff or the question's author.

### D3. Reopening

When `create` inserts a reply, it clears `resolved_at` and `resolved_by_user_id` on its root in the same transaction. It finds the root with a recursive CTE up the `parent_followup_id` chain.

### D4. Questions and the filter

- `PostService.project` adds `unresolvedFollowups` for questions:

  ```sql
  SELECT count(*) FROM followups
  WHERE post_id = $1 AND parent_followup_id IS NULL
    AND deleted_at IS NULL AND resolved_at IS NULL
  ```

- `PostService.list` accepts `unresolvedFollowups: true`. It adds `p.type = 'question' AND EXISTS (…the same predicate…)` and binds the cursor through the filters, like the other filters. The visibility clause from private posts already applies.

### D5. Web

- **Followup client.** The followup client gains `setFollowupResolved(id, resolved, csrf)`.
- **Discussion control.** For a root followup with `canResolve`, a two-state segmented control (**Unresolved** / **Resolved**, using `aria-pressed`) that updates the followup in place and reports the change, so the post detail and feed row can adjust `unresolvedFollowups`.
- **Read-only label.** Without `canResolve`, a **Resolved** or **Unresolved** label.
- **Feed badge.** The question card shows "N unresolved" (attention tone) when N is greater than 0.
- **Staff filter.** An **Unresolved** sidebar filter, `unresolvedFollowups=true`, kept in the URL like the other filters.
- **Replying.** After a new reply, the discussion's root shows **Unresolved**, because the client re-reads the root followup as it already does after replies settle.

## Risks / Trade-offs

- **[Every existing discussion starts unresolved, so the first queue is long]** → This is accurate rather than optimistic, and staff can clear it quickly. Backfilling "resolved when staff replied last" would guess wrong in both directions.
- **[A staff reply also reopens a discussion]** → The user chose "any new reply reopens". Staff can resolve again in one click.
- **[A count subquery on every question projection]** → The partial index keeps it to an index lookup per question, and feed pages are at most 100 posts.

## Migration Plan

Migration 027 adds two nullable columns, the checks, and the partial index. Rolling back drops them.
