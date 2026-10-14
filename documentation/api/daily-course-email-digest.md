# Daily course email digest

Daily email delivery is an opt-in account preference on [`GET` and `PATCH /api/v1/users/me`](auth.md). Set `dailyDigestEnabled` to `true` with the current profile `If-Match`, authenticated session, allowed `Origin`, and session CSRF token. The response returns the updated preference and ETag. The default is `false`.

At or after 00:00 UTC, the backend starts dispatching a separate plain-text email for each active course with qualifying activity on the previous UTC calendar date. An opt-in on October 14 is eligible at midnight October 15 for October 14, including activity from before the opt-in time. A disabled preference cancels unsent messages; re-enabling does not backfill earlier dates.

Qualifying activity is creation of a question, shared answer, or root/reply followup by someone other than the recipient. The recipient must still be an active member, and the course must still be active. Notes, own activity, edits, votes, endorsements, deleted content, confirmed duplicate questions, followup tombstones, and hidden parent questions are excluded. Empty course days send no email. The message summarizes counts and links to visible posts without exposing anonymous contributors' identity.

PostgreSQL stores one durable intent per `(recipient, course, UTC activity date)` and retries SMTP errors. Missed midnight runs are recovered after restart. The worker rebuilds content and checks opt-in, membership, course status, and visibility immediately before sending. The database marks success after SMTP accepts the message. If the worker crashes between acceptance and recording success, a retry can rarely send the same email twice; SMTP does not provide a general exactly-once guarantee.
