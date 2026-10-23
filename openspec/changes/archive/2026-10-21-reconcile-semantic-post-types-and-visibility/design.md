## Context
Main now has author-and-staff private posts, polls, announcements, notifications and live code sessions. The unmerged semantic feature predates these post types.

## Goals / Non-Goals
Preserve exact main authorization and lexical behavior. Semantic features continue to cover only questions and notes; do not index or semantically expand polls. Keep generation ownership, fallback, durable catch-up and separate worker. No privacy model, statistics fix, audience-branch changes or answer live editing.

## Decisions
Retain readablePost/canReadPost at existing main read boundaries and apply it to the final visible candidate set before ranking/page limits. Restrict semantic enqueue/backfill/index/health/candidate queries to question/note eligibility, including stale poll artifacts. Poll-only search uses lexical/fuzzy logic without a query provider call. Private-to-public reads use current authoritative visibility; title/body changes retain existing revision checking. Union job types/metrics and recordActivity with existing semantic hooks.

## Risks / Trade-offs
Hidden rows must not influence hasMore or pagination, and obsolete noneligible rows must not make semantic health unhealthy. Exercise real HTTP/PGvector role/membership and worker boundaries. Existing statistics treatment of private activity is outside this change.
