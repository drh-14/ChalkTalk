# Proposal

## Why

Followup discussions have no state, so after office hours a TA cannot tell which threads still need a reply without rereading every question. Piazza marks each followup resolved or unresolved and gives staff an "Unresolved" view to work through. Now that members are notified of activity, a clearable queue is what lets staff keep up.

The user decided:

- TAs, instructors, and the question's author can mark a followup discussion resolved or unresolved;
- any new reply in a resolved discussion reopens it automatically.

## What Changes

- **Resolved state.** Each root followup discussion (a followup with no parent) is resolved or unresolved. New discussions start unresolved, and existing discussions start unresolved too. Replies have no state of their own; they belong to their root's discussion.
- **Resolving.** TAs, instructors, and the question's author can mark a discussion resolved or unresolved. Other members see the state but cannot change it.
- **Reopening.** A new reply anywhere in a resolved discussion, at any depth, makes it unresolved again.
- **Queue.** Each question reports how many unresolved discussions it has. The feed shows "N unresolved" on question cards, and staff get an **Unresolved** filter that lists questions with at least one unresolved discussion.
- **Quiet changes.** Resolving or reopening changes neither the followup's revision (so an in-progress edit is not disturbed) nor the question's last activity (so it does not resurface in feeds or create unread markers or notifications).

## Capabilities

### New Capabilities

- `followup-triage`: the resolved state of followup discussions, who can change it, automatic reopening, and the unresolved queue.

### Modified Capabilities

None. Followup and post projections gain fields defined in `followup-triage`.

## Impact

- **Database:** migration `027_followup_resolution.sql` adds `followups.resolved_at` and `followups.resolved_by_user_id` (roots only, by check constraint) and a partial index on unresolved root followups.
- **API:**
  - `PUT` and `DELETE /api/v1/followups/{followupId}/resolution`;
  - `resolved` and `canResolve` on followup projections;
  - `unresolvedFollowups` on question projections;
  - an `unresolvedFollowups=true` list filter;
  - the error `not_a_discussion` for resolving a reply.
- **Web:** a Resolved/Unresolved control on each discussion, the "N unresolved" feed badge, and the staff **Unresolved** filter.
- **Docs:** `answers.md` (followups), `posts.md`, `openapi.yaml`, and `database.md`.
- **Coordination:** stacked on `add-private-posts` (PR #67). Private posts stay hidden from the queue exactly as from every other list.
