## Why

Instructors cannot currently control whether a course permits anonymous contributions, private posts, or followup resolution. A course-wide policy should make these choices explicit without retroactively changing existing discussion.

## What Changes

- Add three instructor-managed, default-enabled course switches for anonymity, private posts, and followup resolution to the existing conditional course update API and settings screen.
- Apply anonymity and private-post restrictions to future applicable posts, answers, and followups (including replies), while preserving existing content and ordinary edits.
- Leave existing resolution markers visible when resolution is disabled, but reject all marker changes until it is enabled again, including automatic reopening on reply.
- Preserve successful idempotent creation retries across a later policy change.

## Capabilities

### Modified Capabilities

- `course-management`: Expose and manage the effective course policy with instructor-only conditional updates.
- `text-posts`: Enforce current policy on new posts and anonymity changes to existing posts.
- `question-answers`: Enforce current anonymity policy on new answers.
- `question-followups`: Enforce current anonymity policy on new followups and replies, and current resolution policy on marker mutations.
- `course-discussion-frontend`: Show course settings and constrain applicable composers to the effective policy.

## Impact

Adds non-null, default-enabled columns to `courses`; extends course JSON and PATCH validation, content creation and resolution service paths, web client/types/settings/composers, API/database references, OpenAPI, integration tests, and mock-API browser scenarios. No new dependency or service.
