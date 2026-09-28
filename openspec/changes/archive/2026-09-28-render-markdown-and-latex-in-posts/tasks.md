## 1. Selection and caret behavior

- [x] 1.1 Add failing pure tests that model selected and empty ranges for bold, italic, inline code, inline math, link, heading, bullet list, numbered list, and block math; verify each test asserts the complete resulting string, intended caret/selection, and content between delimiters.
- [x] 1.2 Implement a deterministic post-body formatting transform for those actions; verify the pure tests pass, including multiline selections and beginning/end-of-document boundaries.

## 2. Safe shared rendering

- [x] 2.1 Add failing rendering tests for Markdown, `$...$` inline math, standalone `$$` block math, malformed TeX, hostile HTML, unsafe links, and consistent output in Preview, ordinary detail, and duplicate review; verify the failures identify missing rendering behavior.
- [x] 2.2 Add compatible CodeMirror 6, `remark-math`, `rehype-katex`, `katex`, and `rehype-sanitize` frontend dependencies and locally bundled KaTeX CSS; verify dependency installation and the frontend build succeed.
- [x] 2.3 Implement one shared post-body renderer with the default sanitizer schema, safe URLs, untrusted KaTeX options, and bounded math resources; verify rendering and hostile-content tests pass without enabling raw HTML.

## 3. Composer toolbar and Preview

- [x] 3.1 Add failing React interaction tests that set real source-editor selections, activate every toolbar button, and type inside the inserted delimiters; verify focus, selected-line numbering, link destination caret, and standalone block-math boundaries are asserted.
- [x] 3.2 Add failing interaction tests for Write/Preview draft retention, unchanged unsent fields, raw `bodyMarkdown` submission, and draft retention after a failed create request; verify the expected failures precede implementation.
- [x] 3.3 Replace the body textarea with a labeled CodeMirror source editor, wire the toolbar and read-only Preview into the composer, preserve editor selection after controlled updates, and use the shared renderer in both post-detail paths; verify all focused web tests pass.
- [x] 3.4 Style the toolbar, Preview, math output, and keyboard focus for desktop and narrow layouts; verify a browser smoke check can use the controls and read math at both widths.

## 4. Live LaTeX diagnostics

- [x] 4.1 Add failing tests that check diagnostics after each edit for valid and rejected closed inline/block math, neutral unfinished math, escaped dollars, code spans, immediate correction/removal, stale-result isolation, and accessible messages; verify the tests fail for missing per-range feedback.
- [x] 4.2 Implement per-edit Markdown/math span discovery and KaTeX validation with the same trust/resource limits as rendering, using CodeMirror decorations for red underlines and textual diagnostics; verify the diagnostic tests pass without relying on an idle debounce.
- [x] 4.3 Measure a long-body typing interaction and check that diagnostic work does not stall editing, lose the caret, or replace current results with stale ones; verify the interaction test and a browser smoke check pass.

## 5. Verification and handoff

- [x] 5.1 Run the full test suite, format check, lint, typecheck, build, and strict OpenSpec validation; verify each command exits successfully and record any remaining issues.
- [x] 5.2 Inspect the final diff for API/schema scope and unsafe rendering paths, then archive the completed OpenSpec change; verify the archived specs include the new behavior and the worktree contains no untracked change artifacts.
