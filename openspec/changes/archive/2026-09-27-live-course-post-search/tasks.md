## 1. Contract and tests

- [x] 1.1 Validate the OpenSpec change strictly before application code.
- [x] 1.2 Write failing rendered tests for 300 ms live search, no Search button, unchanged results before debounce, URL `q` replacement, immediate clear, explicit relevance sort, 500-character limit, and preserved search syntax.
- [x] 1.3 Write failing route/app interaction tests for live query changes without per-edit Back entries, preserving selected post and unsent composer draft, and restoring URL query through Back/Forward.
- [x] 1.4 Write or adapt failing tests for query-change cursor reset, stale response isolation, and existing pagination/retry behavior.

## 2. Implementation

- [x] 2.1 Implement debounced live search and immediate clear in the discussion view without a Search button or submit-only form.
- [x] 2.2 Add route-state replacement for live `q` edits and keep discussion state mounted across query changes, without changing normal post/page navigation history.
- [x] 2.3 Modestly enlarge only the discussion course-title font; retain the current left-panel width.

## 3. Verification

- [x] 3.1 Run focused and full web tests, lint, typecheck, format, build, strict OpenSpec validation, and relevant Compose smoke checks.
- [x] 3.2 Record verification and archive the OpenSpec change after implementation is complete.
