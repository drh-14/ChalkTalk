## Context

See `proposal.md` and `specs/advanced-polls/spec.md`. Merged PR #65 added poll creation, one `poll_votes` row per member, a `PollCard`, and immediate per-option counts in every post projection. `text-posts` main spec still describes pre-#65 rejection because the #65 delta is unarchived; implementation must use the deployed code/API as its baseline and coordinate that spec cleanup separately.

## Goals / Non-Goals

**Goals:** Extend the existing post and vote seams without a new service or dependency; keep all old ballots and old clients functional; make visibility a server-side viewer-aware rule; make deadlines effective without depending on the job worker.

**Non-Goals:** Anonymous/unlinked ballots, voter rosters, per-voter export, option editing, student-created polls, scheduled emails, results becoming hidden again, or a second poll authoring system.

## Decisions

### D1. Additive poll configuration and multi-choice rows

Add a one-to-one `poll_settings` row for each poll (selection mode, maximum, optional `closes_at`, manual `closed_at`, release mode, `results_released_at`, optional explanation), with a same-course post foreign key and constraints for valid modes and limits. Migration 048 is reserved conceptually; choose the actual next free number after checking all concurrent migrations. Existing polls receive settings representing single-select, no deadline, and already-released results. For new legacy-shaped single-select requests use those same defaults. New multi-select requests require an explicit manual or automatic-on-close release mode; they cannot use live release. For a new poll that explicitly chooses controlled release, start unreleased.

Change `poll_votes` from one row per `(post_id,user_id)` to one row per `(post_id,user_id,option_id)`; preserve every existing vote in place while replacing the primary key. A member's set of rows is one ballot, so `totalVotes` continues to mean member ballots, not selected options. Query counts per option and `count(DISTINCT user_id)` for total. This is smaller than a second ballot table, but requires transactional replacement and careful distinct counting. Database foreign keys still guarantee every choice belongs to its poll; service validation enforces maximum and nonempty selection.

*Alternative rejected:* A new ballots header/choices pair creates more joins and migration surface without a current need for ballot-level metadata.

### D2. One serialized lifecycle and ballot seam

Continue using the post-row transaction lock for vote changes, and use it for retraction, close/reopen, and release as well. Validate membership, active course/post, then effective close (`closed_at` or deadline at current database time) and option set; delete/insert the caller's selection atomically. The old `{optionId}` payload remains accepted on single-select polls; a new `{optionIds}` payload replaces the whole ballot. Keep CSRF and existing `not_a_poll`, `poll_option_invalid`, `poll_closed`, not-found, and ETag conventions. Closed retraction is now rejected (existing basic polls allowed it in archived courses), as agreed for all vote changes; an already-open old poll continues to work.

Use dedicated staff-only POST actions under the post (`/close`, `/reopen`, `/release`) with `If-Match` and the established ETag response. Close/reopen advances post version but ballot changes do not. `results_released_at` is write-once. Reopen clears an elapsed deadline; otherwise it would immediately close again. A deadline is evaluated in read and write paths so a stopped worker cannot leave a poll voteable. Automatic release is inferred from effective close even before any background persistence, then persisted in the next serialized state-changing transaction. Reopen must materialize release first, preventing an inferred release from disappearing. Manual release can happen while open or closed.

*Alternative rejected:* A required scheduled close job creates failure/retry dependence for correctness. A single PATCH action with multiple unrelated fields risks accidental state transitions and ambiguous concurrency.

### D3. Viewer-specific projections enforce privacy

Extend existing `PostService.project`/`pollState` so only staff or a viewer of released results receives `voteCount`, `totalVotes`, percentages, and explanation. Every member always receives their own `selected` flags and non-sensitive poll settings/status. The vote response uses the same projection policy, not a shortcut containing raw counts. Avoid public/shared caches for these projections; preserve private/no-store response caching where applicable. Never expose ballot rows or voter IDs via API or diagnostic export. Staff CSV comes from an aggregate query and includes option label, count, and ballot total. Escape CSV values, including formula-leading labels.

*Alternative rejected:* Hiding counts in React is insecure because API consumers and browser dev tools would still receive them.

### D4. Clone through the existing post creation path

A staff-only clone action reads an accessible active source poll and calls the existing creation path within an atomic operation, copying title/body/options and stable settings but omitting deadline, closed/released state, and all ballots. It gets a new post ID and starts open/unreleased even when the source was an old live-results poll. The clone's default visibility is deliberately reset as agreed; for a legacy `live` source, the clone uses `manual` release so it can start unreleased. The staff UI must make that clear. This action must not copy a private audience or attachments (polls cannot be private and attachment cloning was not requested).

*Alternative rejected:* Copying database rows directly would bypass existing validation, idempotency, audit, and post-create behavior.

### D5. Extend, do not replace, the existing UI

Add poll controls to the current composer and extend `PollCard` with checkbox/radio modes, accessible maximum guidance, own selections, a no-results-yet state, and staff lifecycle/export/clone actions. The post client must model counts as absent until release; no placeholder zeroes that imply a result. Preserve basic poll rendering and vote behavior. Browser tests mock the API by default and capture one screenshot per visible scenario.

## Risks / Trade-offs

- [Changing the `poll_votes` key can lose or double-count legacy ballots] → Migrate within a transaction, assert row counts before/after, test with existing voters and fresh polls.
- [Multi-select counts can exceed ballot total] → Label `totalVotes` as ballots and document that option counts are selections; derive both independently.
- [A deadline races a vote or reopen] → Use database time and the same post lock for all mutations; test boundary and concurrent requests.
- [Release could be undone when a due poll reopens] → Treat effective auto-release as monotonic and materialize it before reopening.
- [An unreleased count can leak via one response shape] → Contract-test list, detail, vote, export, clone, and unauthorized roles with viewer-specific projections.
- [OpenSpec baseline remains contradictory] → Resolve the already-merged #65 delta before archiving this change; do not change #65 scope in this PR without approval.

## Migration Plan

1. Select the next free migration number (048 is a reservation, not an instruction to overwrite another migration); add settings and widen the vote key with reversible data-preserving DDL where feasible.
2. Backfill existing polls as single-select/open/live-released and verify existing vote row counts. Deploy API that accepts both old and new vote payloads before new UI uses the latter.
3. Add the web controls and browser scenarios. Update the canonical API and database references alongside API behavior.
4. If rolled back, restore the old application only after advanced multi-choice ballots are converted or removed; down-migrating to one choice per voter would be lossy, so prefer forward repair and keep a database backup.
