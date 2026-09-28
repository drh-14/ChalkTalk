## Context

`postListQuery` in `apps/api/src/http/app.ts` validates list parameters against an allowlist and passes a `ListPosts` object to `PostService.list`. `list` builds SQL clauses and computes one `rank_value` per row: creation time for `newest`, last-activity time for `recent_activity`, and full-text rank for `relevance`. It then orders `rank_value DESC, id DESC` and pages with an opaque cursor `{binding, value, id}` compared as `(rank_value, id) < (value, id)`. The cursor binding is a hash of the course, the viewer, and every non-pagination option, so any new option is bound automatically. `authorId` already applies the hidden-identity rule for students: it excludes deleted authors and anonymous posts that are not the viewer's own. Account deletion removes the user's course memberships. On the web, `feedFilters(userId)` in `apps/web/src/posts/types.ts` builds the sidebar from the post type list, and each type's `filters` are nested beneath it.

## Goals / Non-Goals

**Goals:**

- Add the three options without changing any existing response, default, or cursor for current callers.
- Keep every new filter compatible with pagination, search, and the identity rules.

**Non-Goals:**

- Sorting by amount of activity, a `student` author role, or storing the author's role at posting time.
- Filtering duplicate review by these options; staff review keeps its own request.

## Decisions

**Oldest reuses the creation-time key and flips direction.** `sort=oldest` uses the same `date_trunc('milliseconds', p.created_at)` rank as `newest`, orders `rank_value ASC, id ASC`, and compares the cursor with `>` instead of `<`. Cursor validation is identical to `newest`, because both carry an ISO timestamp. The alternative, a separate ascending query builder, would duplicate the filter and projection code for one sort.

**`pinned` is parsed like `answered`.** The value must be `true` or `false`, otherwise `400 invalid_request`. It adds `p.pinned = $n`. It combines with `type`, so the sidebar's Pinned entries send `type` and `pinned` together.

**`authorRole` checks the author's current membership role.** `instructor` and `ta` are separate values, because instructors and TAs are distinct audiences. It adds `EXISTS (SELECT 1 FROM course_memberships am WHERE am.course_id = p.course_id AND am.user_id = p.author_user_id AND am.role = $role)`. Because account deletion removes memberships and post deletion clears `author_user_id`, deleted accounts and tombstones never match, and a member whose role changed matches only the new role, with no special case. For a student viewer, it also adds `(p.anonymous = false OR p.author_user_id = $viewer)`, the same visibility clause `authorId` uses, so an anonymous post's inclusion never reveals its author's role. A single value per request keeps it consistent with the other single-choice sidebar filters; a combined "all staff" value or a `student` value can be added later without a breaking change. Recording the role at posting time was considered, but it needs a migration and would keep labeling posts with a role their author no longer holds.

**Frontend filter entries carry full options and an accessible name.** Each sidebar entry already carries a `PostListOptions` object. The question Pinned entry uses `{ type: "question", pinned: true }`, the note Pinned entry uses `{ type: "note", pinned: true }`, Instructor posts uses `{ authorRole: "instructor" }`, and TA posts uses `{ authorRole: "ta" }`. Entries gain an optional `ariaLabel` ("Pinned questions", "Pinned notes") so repeated visible labels stay distinguishable. The shared entries (My posts, Instructor posts, and TA posts) are defined in `feedFilters` rather than on a post type, because they apply to all types. `PostListOptions` gains `pinned` and `authorRole`, and `PostSort` gains `oldest`.

## Risks / Trade-offs

- [A TA promoted to instructor moves from TA posts to Instructor posts, and a demoted member's posts leave both.] → This is intended: the filters reflect current course roles. It is recorded in the docs.
- [An `EXISTS` subquery per row on large courses.] → `course_memberships` is keyed by `(course_id, user_id)`, so each check is an index lookup; pages are capped at 100 rows.
- [This changes the API contract owned by other team members.] → The proposal flags coordination before implementation.
