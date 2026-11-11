## Boundary

Resolve the earliest persisted timestamp relevant to the existing statistics queries: question or answer creation, retained question creation count, answer contribution, post view, or endorsement. Convert it to a UTC day and take the earlier of that day and the course creation day. Only `course_to_date` uses this lookup; fixed 7-day and 30-day windows are unchanged.

Use the same resolved bounds for summary, paginated students, daily CSV, and roster CSV. Generate zero-filled date arrays only for daily summary/CSV, not for student rows. The existing aggregate queries and access control remain authoritative.

No new index or migration is necessary for the initial implementation. Validate a multi-year fixture and review query timing before publication.
