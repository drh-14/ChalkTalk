## Context

The course JSON and instructor-only PATCH already use course-row locking and ETags. Content creation uses transactions with idempotency replay, and reads the course status through membership or question queries. Resolution is a separate followup mutation with an automatic clear on reply.

## Goals / Non-Goals

**Goals:** Single authoritative course-row policy, deterministic update/create ordering, current-user UI affordances, unchanged existing content, and matching idempotency behavior.

**Non-Goals:** Retroactive anonymity/privacy rewrites, private-audience group controls, per-post locks, or a new policy service.

## Decisions

- Add three non-null booleans to `courses` in migration 051, default true. Project them through all existing course queries rather than a separate endpoint. Alternative: settings table; rejected because this policy is 1:1 course state and belongs to the existing conditional update.
- Reuse instructor-only PATCH, strict boolean validation, and current ETag/version. Alternative: dedicated policy endpoint; rejected as redundant contract and UI complexity.
- Extend existing `FOR SHARE` course reads in post, answer, and followup creation to include policy columns. The instructor PATCH holds `FOR UPDATE`, giving a serialized order. Evaluate policy after idempotency replay so retry of a committed creation remains successful. Alternative: unlocked policy read; rejected because concurrent changes could produce ambiguous outcomes.
- Do not use a trigger to reject historical anonymous/private rows. Check only future creation and a post edit transition to anonymous. Existing content remains untouched.
- Gate explicit resolution in the same transaction as current followup locking, set `canResolve=false` when disabled, and skip reply auto-clear while disabled. Do not rewrite marker state when toggling.
- Pass the course policy to creation surfaces via existing course state where available; fetch current course on direct detail if needed. API remains authoritative for stale composer state.

## Risks / Trade-offs

- [Concurrent creation briefly waits on policy PATCH] → Course-row share/update locks are short and avoid a race.
- [Stale browser policy after another device changes it] → Server rejects the write with a specific conflict and UI surfaces it; refreshing gets current policy.
- [Other in-flight feature PRs modify post/followup views] → Rebase on merged main, resolve only the scoped seams, never import unmerged feature code.

## Migration Plan

Deploy additive default-true columns before new API code. Rollback the application first; columns are harmless to old code. A later rollback may drop the columns only after removing API dependencies.
