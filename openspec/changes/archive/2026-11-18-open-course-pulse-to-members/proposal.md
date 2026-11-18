# Proposal

## Why

The Statistics tab is staff-only, so students cannot see Course pulse: when the class asks questions, which weeks and topics spike, how fast questions are answered, and who helps most. These are class-wide aggregates that help students as much as staff, and the course demo shows them to the whole class.

## What Changes

- Every course member sees the Statistics tab. Students see Course pulse only.
- `GET /api/v1/courses/{courseId}/statistics/pulse` returns the same summary to students as to staff, instead of `403 permission_denied`.
- The Activity view, its per-student table, the activity summary endpoints, and the CSV exports stay staff-only, because they show individual students' activity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-statistics`: the Statistics tab and the course pulse are open to every member; per-student activity stays staff-only.

## Impact

- **API:** the pulse authorization accepts any current member; the other statistics endpoints are unchanged.
- **Web:** the Statistics tab shows for everyone, and the view switcher shows for staff only.
- **Docs:** the pulse access rules in the statistics API reference and OpenAPI.
- **Database:** none.
