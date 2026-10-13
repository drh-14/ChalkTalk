## Context

See the agreed design in `docs/design/2026-10-11-course-statistics.md`. Current posts, answers, and memberships live in PostgreSQL; the statistics routes and view recorder are absent. The UI uses existing course navigation and data-client patterns.

## Goals / Non-Goals

**Goals:** Durable event recording, staff-authorized course-scoped aggregation, and an accessible statistics tab using existing React/CSS.

**Non-Goals:** Analytics service, chart library, reconstructing views before deployment, and implementing the separately planned answer-edit route.

## Decisions

- Add `post_view_events` with a unique course/post/viewer/UTC-date key. Insert after authorized canonical detail read using conflict-ignore. Log insert failures without failing the read. Counting every GET was rejected because refetches inflate views.
- Add `answer_contribution_events`, backfill existing contributors at answer creation time, and insert creation events in the answer transaction. An event-based model supports future period-specific edits; contributor identity rows alone have no edit timestamp.
- Add `question_creation_daily_counts` by creator, course, and UTC date. Increment in the question-create transaction, backfill active questions only, retain counts after post soft deletion, and delete buckets on account or course deletion. The table contains no post identifier; course daily totals still use post creation timestamps.
- Aggregate course-scoped SQL on request with indexes and a query timeout. Background rollups are unnecessary at current scale.
- Scope cursor to course and period, ordered by stable membership/user identity. Compute student counts by left joins so zero-activity current students remain visible.
- Reuse course frame membership detection for staff tab visibility, but authorize both endpoints independently. A hidden tab is not a security boundary.

## Risks / Trade-offs

- Missing predeployment views → Explain the start date in UI; never fabricate historical views.
- Large-course aggregation latency → Index course/date paths and bound query time.
- Future answer editor forgets events → Document the transactional integration contract and add tests when that editor lands.

## Migration Plan

Apply `009_course_statistics.sql`, backfill contribution events, deploy API and UI, and update course deletion cleanup. Rollback requires removing the UI/routes first and then dropping event tables; historical view counts would be lost.
