# Tasks

## 1. Parsing and recording

- [x] 1.1 Migration `028_mentions.sql` with the `mentioned` kind, documented in `database.md`; verify a schema test
- [x] 1.2 `parseMentions` (design D1); verify unit tests for tokens, duplicates, code exclusion, `@staff`, and the 20-user limit
- [x] 1.3 `recordActivity` mention recipients and follower dedupe (design D2); verify through the HTTP tests in 2.1

## 2. API

- [x] 2.1 Mentions on post, answer, and followup creation and edits (design D3); verify HTTP tests for fan-out, membership, deleted accounts, private posts, the actor, `@staff`, edits notifying only new mentions, dedupe with followers, anonymity, and `too_many_mentions`
- [x] 2.2 `GET /api/v1/courses/{courseId}/mention-suggestions` (design D4); verify HTTP tests for matching, ordering, the limit, exclusions, `postId` readability, validation, and membership
- [x] 2.3 Worker email wording for `mentioned` (design D6); verify a worker test
- [x] 2.4 Update `notifications.md`, `posts.md`, `answers.md`, `openapi.yaml`, and `database.md`; verify the YAML parses and references resolve

## 3. Web

- [x] 3.1 Mention rendering in `PostBody` (design D5); verify component tests that a mention renders as a styled name and not a link, and that other unknown protocols are still stripped
- [x] 3.2 Autocomplete in `PostEditor` and wiring in every composer, with the suggestions client; verify component tests for suggestions, **@staff**, and the inserted token
- [x] 3.3 Bell wording for `mentioned`; verify a component test

## 4. Checks

- [x] 4.1 Browser test against the running stack: a student mentions a TA in a followup through autocomplete; the mention renders; the TA sees "mentioned you" in the bell and opens the question. Capture screenshots
- [x] 4.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
- [ ] 4.3 Archive after merge
