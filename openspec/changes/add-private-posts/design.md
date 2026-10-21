# Design

## Context

- **No visibility rule today.** Every read path treats any current course member as able to read any active post. The checks live in several places:
  - `PostService` (`get`, `list` including search and related questions, `update`, `vote`, `setFollowing`);
  - `AnswerService` and `FollowupService` (their post lookup);
  - `ContentAttachmentService` (its parent and post join);
  - `CollaborationSessionService` (anchor checks when creating, reading, and listing sessions);
  - the collaboration WebSocket server's ticket query;
  - `NotificationService` (its `VISIBLE` join) and `recordActivity` recipients;
  - the digest queries;
  - the job worker's announcement, notification, and duplicate emails.
- **Anonymity already varies by viewer.** `PostService.project` shows the author to staff and the author, and "Anonymous" to other students. Private posts reuse that projection unchanged.
- **Missing and unreadable look the same.** Posts the caller cannot read already return `404 not_found`, the same as absent ones, so private posts follow that convention.

## Decisions

### D1. Schema (migration 026)

- `posts.private boolean NOT NULL DEFAULT false`.
- `CHECK (NOT private OR (type <> 'poll' AND NOT announcement))`.
- A partial index `(course_id, last_activity_at DESC) WHERE private AND deleted_at IS NULL` for the **Private** filter.
- Drop and re-add the `notifications.kind` check with `post_published` added.

### D2. One visibility predicate

`apps/api/src/posts/visibility.ts` exports:

```ts
/** SQL that is true when the viewer may read the post aliased `post`. */
export const readablePost = (post: string, viewer: string, role: string) =>
  `(NOT ${post}.private OR ${post}.author_user_id = ${viewer} OR ${role} IN ('ta','instructor'))`;
```

- `viewer` is a bound parameter, and `role` is the viewer's current membership role column.
- Every read path listed under Context adds this predicate wherever it already checks membership.
- Service-level checks that load a post row, such as `PostService.get`, `AnswerService.post`, and `FollowupService.post`, call a TypeScript twin, `canReadPost(row, viewerId, role)`, and throw `notFound()` when it is false.
- Deleted private posts stay hidden from other members too, rather than showing a tombstone.
- Recipients are checked against their current role, so a TA who becomes a student stops seeing private posts and stops being notified about them.

### D3. Writes

- **Create.** Accept `private` only for questions and notes. Reject a private announcement with `private_announcement`, and a private poll with `private_poll`.
- **Update (`private`).**
  - `false` on a private post, from the author or staff, makes it public.
  - `true` on a public post returns `422 post_already_public`; `true` on a private post is a no-op.
  - Making a post public increments `version` and sets `last_activity_at = now()`, so it surfaces for classmates as new and unread.
- **Publish notification.** When the actor is staff and not the author, `recordActivity` creates a `post_published` notification for the author, using a new `recipients: "author"` option. The author's email preference applies, and the worker's wording is `"<actor> made your post public"`.
- **Duplicates.** If the target of `duplicateOfPostId` is private, return `422 duplicate_target_private`. Staff can still read the private target in the review list.
- **Live session invitations.** Inviting a user who cannot read the anchor post returns `422 invitee_cannot_read_post`.

### D4. Lists

- The default feed includes private posts the viewer can read. For staff that is every private post in the course, as in Piazza.
- `private=true` lists only private posts. Any other value returns `400 invalid_request`. The cursor binds the filter, as other filters already do.

### D5. Digest and statistics

- The daily digest is one summary for the whole course, so its post, answer, and followup queries add `NOT p.private`, even for staff recipients.
- Statistics count everything, because they show only aggregate numbers.

### D6. Web

- **Composer.** A **Post to** select offers **Entire class** (default) and **Instructors and TAs**, for questions and notes only. Choosing **Instructors and TAs** unchecks and disables the announcement checkbox.
- **Feed card.** A **Private** badge, built from the existing `PostStatusBadge` with a lock tone.
- **Feed filter.** **Private** in the sidebar's **Show** group, mapped to `private=true` and kept in the URL like the other filters.
- **Post detail.** The notice "Only you and course staff can see this" for the author, or "Only the author and course staff can see this" for staff. For the author or staff, a **Make public** button that confirms first ("Everyone in the course will be able to see this post"), sends `PATCH { private: false }` with `If-Match`, and updates the detail and its feed row.
- **Notifications.** The bell's wording for `post_published` is "<actor> made your post public".

## Risks / Trade-offs

- **[A read path is missed]** → D2 puts the rule in one module, and each path gets an integration test that a classmate receives `404` or nothing (spec: tests cover private posts).
- **[Publishing cannot be undone]** → This is deliberate, because classmates may already have read the post. **Make public** asks for confirmation first.
- **[Staff feeds fill with private posts]** → The **Private** filter, and badges on every card, keep them easy to tell apart. A staff "hide private" filter can come later if it is asked for.

## Migration Plan

Migration 026 adds the column with default `false`, so existing posts stay public. The new kind is added to the notifications check. Rolling back drops the column and restores the check, after deleting any `post_published` notifications.
