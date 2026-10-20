# Tasks

## 1. Schema and API

- [x] 1.1 Add migration `024_polls_and_announcements.sql` (design D1) and update `database.md`; verify schema tests for the type check, the announcement check, option and vote keys, and cascade on post deletion
- [x] 1.2 Poll creation, projection, and the `type=poll` filter (design D2); verify HTTP tests for validation, staff-only creation, projection in list and detail, immutability on PATCH, and answers and followups rejected on polls
- [x] 1.3 Voting routes (design D3); verify HTTP tests for cast, change, retract, counts and `selected` per viewer, `not_a_poll`, `poll_option_invalid`, `poll_closed`, hidden or deleted posts, and CSRF
- [x] 1.4 Announcements (design D2, D4): field, staff-only creation, pinned, not anonymous, type rules, the filter, and queued email jobs; verify HTTP tests for each
- [x] 1.5 The `send_announcement_email` worker handler and metrics label (design D4); verify worker tests for content and truncation, and nothing sent for a deleted announcement, an archived course, a recipient who left, or a deleted account
- [x] 1.6 Update `posts.md` and `openapi.yaml` (polls implemented, the `announcement` field and filter, the vote request), `design.md` (announcement permission), and the course deletion order; verify the YAML parses, references resolve, and the contract test passes

## 2. Web

- [x] 2.1 Posts client: poll and announcement types, `votePoll`, `retractVote`, and the new filters; verify client tests
- [x] 2.2 Composer poll options editor and announcement choice (design D5); verify component tests
- [x] 2.3 `PollCard` voting and results, feed summaries, the badge, and the Show filters; verify component tests

## 3. Checks

- [x] 3.1 Browser test against the running stack: a TA creates a poll, a student votes and changes their vote and sees the counts, and an instructor's announcement appears pinned with its badge and reaches Mailpit; capture screenshots
- [x] 3.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
  - Local run on Windows, 2026-10-20: format, lint, typecheck, build, the posts, answers, followups, statistics, and worker suites, and the poll component and composer tests pass; the browser test passed three runs in a row. Environment-only failures match `main`: the digest and job process-separation tests, and three worker tests that fail intermittently on unmodified `main` when an earlier test's retried job becomes due mid-run.
- [ ] 3.3 Archive after merge
