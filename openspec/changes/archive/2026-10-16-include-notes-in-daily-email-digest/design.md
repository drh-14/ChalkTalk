## Context

Digest eligibility and delivery each have a posts query limited to `type='question'`. The post creation path coordinates questions with the schedule cursor, but not notes. See proposal.md.

## Goals / Non-Goals

Include notes in existing durable digest behavior without adding a new email category or changing question-only statistics.

## Decisions

- Use `post` for both question and note email rows and one combined count. Keep answers and followups separate.
- Include both post types in schedule and delivery queries; preserve the duplicate filter for questions and all existing visibility checks.
- Hold the existing shared schedule-state lock while inserting either post type and use commit-time-oriented `clock_timestamp()` for both. This avoids late-commit omissions. Keep `question_creation_daily_counts` conditional on questions.

## Risks / Trade-offs

Note creation can briefly wait behind a midnight scan, matching current question behavior.
