# Resource text and searchable PDF verification

Browser scenarios run in real Chromium with mocked application APIs. The PDF frame uses mocked bytes; these screenshots do not validate real PDF appearance.

The affected browser suites passed all 23 scenarios, including desktop/mobile inspection, readable/original UTF-8 downloads, permission-sensitive search, retry, poll failure, bounded polling and Check again.

## Captured text and PDF states

- [arrows and text 1280](arrows-and-text-1280.png)
- [arrows and text 390](arrows-and-text-390.png)
- [desktop ready literal text](desktop-ready-literal-text.png)
- [empty](empty.png)
- [error retry](error-retry.png)
- [failed](failed.png)
- [loading](loading.png)
- [original line breaks download](original-line-breaks-download.png)
- [pending refresh](pending-refresh.png)
- [readable paragraphs download](readable-paragraphs-download.png)
- [search result text](search-result-text.png)
- [searchable pdf error](searchable-pdf-error.png)
- [searchable pdf pending](searchable-pdf-pending.png)
- [searchable pdf poll error](searchable-pdf-poll-error.png)
- [searchable pdf ready](searchable-pdf-ready.png)
- [searchable pdf resumed](searchable-pdf-resumed.png)
- [searchable pdf stalled](searchable-pdf-stalled.png)
- [truncated](truncated.png)
- [unsupported](unsupported.png)

## Search regressions

- [instructor controls 1280](../resource-search-ui/instructor-controls-1280.png)
- [instructor controls 390](../resource-search-ui/instructor-controls-390.png)
- [instructor edits kept](../resource-search-ui/instructor-edits-kept.png)
- [instructor text status](../resource-search-ui/instructor-text-status.png)
- [linux creation drafts restored](../resource-search-ui/linux-creation-drafts-restored.png)
- [linux mobile fallback font](../resource-search-ui/linux-mobile-fallback-font.png)
- [loading results](../resource-search-ui/loading-results.png)
- [mobile results](../resource-search-ui/mobile-results.png)
- [no results](../resource-search-ui/no-results.png)
- [retry recovered](../resource-search-ui/retry-recovered.png)
- [search error](../resource-search-ui/search-error.png)
- [student content search](../resource-search-ui/student-content-search.png)
- [student no status](../resource-search-ui/student-no-status.png)

## Validation status

Linux verification passed 199 backend tests (four database-dependent tests skipped) and 237 frontend tests, including the files that failed in the Windows run. The Windows full suite reported 871 passed, 26 failed and 791 skipped; missing tools, file locking and runtime differences were resolved for those failed files by the Linux reruns. Full database coverage is left to final-head CI. Strict OpenSpec validation passed for all 40 items. Formatting (respecting Git exclusions for local handoff files), lint (excluding ignored worktrees), typechecking and both production builds passed.

The no-mistakes gate did not pass. Run 01M6N032F083M9KBRKR9NV5CK5 completed rebase and independent Review; its Test phase was cancelled after it started real-API browser tests despite the mocked-API verification plan. Its three informational Review cleanup findings are addressed here. The archived delivery checklists retain their incomplete gate task. Original and rebased gate commits remain locally archived.

The owner-approved OCR replacement margin is retained: a usable selectable layer is replaced only when OCR exceeds 1.5 times its non-whitespace length plus 20 characters. This protects exact slide text but can omit a shorter scanned body beneath a long selectable notice. Searchable PDF copies are rasterized and can lose fine zoom detail and original interactive links.
