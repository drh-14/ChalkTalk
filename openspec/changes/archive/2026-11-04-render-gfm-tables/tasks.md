# Tasks

## 1. Browser rendering

- [x] 1.1 Add tests that `PostBody` renders a pipe table, strikethrough, and a bare URL link, and still sanitizes raw HTML
- [x] 1.2 Add `remark-gfm` to the web workspace and `PostBody`, with a horizontally scrolling table wrapper and table styles

## 2. Piazza import

- [x] 2.1 Add converter tests for a grade-distribution table, ragged rows, a pipe and line break in a cell, and inline formatting in a cell
- [x] 2.2 Add the Turndown table rule

## 3. Verification

- [x] 3.1 Browser test with a mocked API: a post with a table renders as a table on desktop and scrolls inside the body at phone width; capture screenshots
- [x] 3.2 Run typecheck, lint, and the affected unit tests
- [x] 3.3 Re-import CSE 416 locally and confirm the grade distribution posts show tables
