## Why

Courses and memberships now exist, but members cannot create or read course discussion posts. This phase adds the text-based foundation while preserving course isolation and the documented anonymous-author visibility rules.

## What Changes

- Implement JSON creation, course listing/search, retrieval, JSON update, and deletion for `question` and `note` posts.
- Persist posts and normalized course tags, with same-course duplicate references, optimistic revisions, idempotent creation, and retained deletion tombstones.
- Enforce current course membership on every route, including global post-ID routes, and project author identity for each viewer.
- Add HTTP/PostgreSQL contract tests, prioritizing hidden identities, cross-course access, and pre-pagination author filtering.
- Extend course deletion cleanup to remove post and tag data safely.
- Clarify the target API documentation's contradictory tombstone example and duplicate-suggestion access wording. Subject to review, label future-only poll and attachment behavior in Markdown and OpenAPI without deleting its target definition.

## Non-Goals

- Polls, voting, attachments, multipart requests, SeaweedFS, download or refresh endpoints, and browser posts UI.
- Answers, followups, and view-event recording. Questions return `answered: false` until answers exist.

## Capabilities

### New Capabilities

- `text-posts`: Course-scoped question and note lifecycle, discovery, and viewer-specific identity visibility.

### Modified Capabilities

- `course-management`: Durable course deletion also clears posts and tags before removing a course.

## Impact

- Adds a PostgreSQL migration, post domain service and HTTP routes, deletion-worker changes, and integration tests.
- Uses the existing API stack and PostgreSQL; adds no runtime dependency or Compose service.
- This branch is based on the open courses branch and must remain separate from the courses PR.

## Decision Pending Review

Should canonical `documentation/api/posts.md` and `documentation/openapi.yaml` carry prominent implementation-status notes for deferred poll/multipart/vote behavior? Recommendation: yes, while preserving those future contracts. No application implementation begins until this OpenSpec change and that choice are approved.
