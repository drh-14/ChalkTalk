## 1. Contract and persistence

- [x] 1.1 Add API/database reference updates for saved state, viewer filters, snapshot and new-count semantics, including privacy and best-effort limitation.
- [x] 1.2 Add integration tests first for save/unsave, privacy, projection, combined filters/cursor, new count, invalid tokens, and hidden/deleted posts; verify expected red.
- [x] 1.3 Add `041_saved_posts.sql` and implement the API/service behavior; verify integration green.

## 2. Feed UI

- [x] 2.1 Add frontend client, URL, and rendered interaction tests first for Saved/Unread/Following and refresh prompt; verify expected red.
- [x] 2.2 Add filters, save control, polling, and non-disruptive refresh behavior; verify tests green.
- [x] 2.3 Add API-mocked real-browser scenarios and screenshots covering matching/nonmatching prompts, saved filter, and detail/composer preservation.

## 3. Delivery

- [x] 3.1 Run focused and repository checks, then archive the OpenSpec change.
