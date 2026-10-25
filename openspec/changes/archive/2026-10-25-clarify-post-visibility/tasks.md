## 1. Specify and test

- [x] 1.1 Validate this OpenSpec change with `openspec validate clarify-post-visibility --strict`.
- [x] 1.2 Update composer tests for Public/Private labels, payload, and public-only poll/announcement behavior; confirm the focused test fails for the expected old UI.

## 2. Implement and verify

- [x] 2.1 Update the composer visibility selector and pass the focused test.
- [x] 2.2 Run API private-post regression tests, typecheck, lint, formatting, and a mocked browser path for public/private/restricted visibility with screenshots.
- [x] 2.3 Sync the UI contract into the main spec and archive the verified OpenSpec change; verify the resulting spec text and archive files.
