## 1. Analyze complete expressions

- [x] 1.1 Add a failing pure-analysis test for exact inline/block offsets, escaped dollars, code, and invalid/incomplete expressions.
- [x] 1.2 Return valid formula spans and invalid diagnostics from the existing parser using the shared KaTeX policy; pass versioned results through the worker.

## 2. Render and reveal inside CodeMirror

- [x] 2.1 Add a failing composer interaction test for valid inline math rendering and caret/boundary reveal; implement source-backed replacement widgets.
- [x] 2.2 Add failing composer tests for block math, pointer activation, selections, transitions between valid and invalid, toolbar, clipboard, undo/redo, raw submission, stale responses, and failure fallback; implement each behavior in vertical slices.
- [x] 2.3 Style rendered math, focus, diagnostic, and narrow-layout reflow without changing the separate Preview.

## 3. Verify and hand off

- [x] 3.1 Run focused and full web tests, format check, lint, typecheck, build, and strict OpenSpec validation.
- [x] 3.2 Run a real-browser smoke check for keyboard/pointer/IME interaction and narrow layout; inspect scope and archive the change after all checks pass.
