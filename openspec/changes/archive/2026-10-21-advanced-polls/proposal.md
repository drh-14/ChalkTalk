## Why

Basic polls support only a single live choice and immediately visible totals. Course staff need richer ballots and controlled closing and result release without exposing a student's vote or replacing the already merged poll foundation.

## What Changes

- Add staff-configurable single- or multi-select polls, including a maximum number of choices, optional deadline, staff close/reopen, and manual or automatic-on-close result release.
- Preserve member-linked ballots internally so members can revise or retract before close, while keeping identities out of all member/staff views and CSV exports. Staff see live aggregates; students see aggregates and the optional explanation only after release. Release cannot be reversed.
- Add aggregate-only CSV export and staff cloning of poll settings and options. A clone starts with no ballots, deadline, or release state.
- Preserve existing polls as single-select, open polls with live results, so deployed content and clients remain usable; clients that opt into new poll forms use the new contract.

## Capabilities

### New Capabilities

- `advanced-polls`: Ballot modes, lifecycle, result visibility, privacy, export, cloning, and UI behavior layered on existing polls.

### Modified Capabilities

- None. The merged basic-polls change remains an unarchived delta to `text-posts`; this change does not rewrite that existing baseline.

## Impact

- Database: additive poll configuration and ballot persistence (migration 048 reserved conceptually; final number must be checked at implementation).
- API: poll create/projection/vote contracts plus staff lifecycle, export, and clone operations in `apps/api/src/posts`, `apps/api/src/http`, `documentation/api/posts.md`, `documentation/openapi.yaml`, and `documentation/database.md`.
- Web: existing poll composer, `PollCard`, post client/types and views; no new dependency or service is proposed.
- Tests: PostgreSQL-backed contract tests first, web component tests, and real-browser scenarios with API mocked and screenshots.
- Spec coordination: `add-polls-and-announcements` (merged PR #65) has not yet been archived into the main `text-posts` spec, which still says polls are rejected. Reconcile that existing spec state before archiving this change; do not duplicate #65 implementation.
