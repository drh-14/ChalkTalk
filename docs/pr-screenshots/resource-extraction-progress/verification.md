# Extraction progress verification

- Backend: 246 tests passed in disposable PostgreSQL/S3-compatible storage with real OCR tools; no skipped cases.
- Frontend: 33 resource component/watcher tests and 31 real Chromium mocked-API scenarios passed; none skipped. The final browser run passed 30 cases initially; one navigation timed out during Vite dependency optimization and passed on focused rerun with a 60-second startup allowance. An unfiltered rerun was abandoned because Playwright collected Vitest files; only explicitly scoped browser runs count as evidence.
- Tests demonstrate worker callbacks/API fields missing before implementation, plus regressions for stale ownership, requeues without consuming an attempt, and an in-flight poll exceeding its deadline.
- API/backend and frontend typechecks, scoped lint/formatting, production builds and strict OpenSpec validation passed.
- Browser coverage includes automatic text/download updates, desktop/mobile progress, retained drafts/files/catalog/search pages/snippets, visibility recovery, transient errors, stale replacement, authorization loss and bounded polling.

- Gate `01M6PR7E3PXNFH73W63JE0TV1T`: Review, Document and Lint passed with no unresolved findings after two fixes. Native Test was deliberately skipped because its previous execution violated the mocked-API browser constraint; the direct suites above provide test evidence, not a native Test gate pass. Push/PR/CI gate phases were handled separately.
- Migration059 deployed to the local demo without resets, seeds or requeues. All app services healthy; authenticated metadata exposes textProgress. The existing one upload remains ready with null progress. No pending demo upload existed; pending-to-ready behavior is covered by disposable backend and mocked browser tests.

## Screenshots

- [desktop authorization loss](desktop-authorization-loss.png)
- [desktop automatic ready](desktop-automatic-ready.png)
- [desktop catalog retained after search](desktop-catalog-retained-after-search.png)
- [desktop check again](desktop-check-again.png)
- [desktop hidden retains progress](desktop-hidden-retains-progress.png)
- [desktop loaded catalog selected file](desktop-loaded-catalog-selected-file.png)
- [desktop loaded search snippets retained](desktop-loaded-search-snippets-retained.png)
- [desktop ocr](desktop-ocr.png)
- [desktop preparing](desktop-preparing.png)
- [desktop queued](desktop-queued.png)
- [desktop replacement discards old poll](desktop-replacement-discards-old-poll.png)
- [desktop same-file edit completes automatically](desktop-same-file-edit-completes.png)
- [desktop saving](desktop-saving.png)
- [desktop transient error recovered](desktop-transient-error-recovered.png)
- [desktop transient error retains progress](desktop-transient-error-retains-progress.png)
- [mobile automatic ready](mobile-automatic-ready.png)
- [mobile ocr](mobile-ocr.png)
- [mobile preparing](mobile-preparing.png)
- [mobile queued](mobile-queued.png)
- [mobile saving](mobile-saving.png)
- [student closed no card progress](student-closed-no-card-progress.png)
- [student open panel ocr](student-open-panel-ocr.png)

Existing extracted-text and resource-search scenarios also passed; their refreshed captures are in the neighboring resource-extracted-text and resource-search-ui directories.

## Delivery

Draft [PR156](https://github.com/drh-14/ChalkTalk/pull/156) is stacked on PR147 and contains one scoped commit. All five CI jobs passed on ea63d3590d20a6ee6fa10806779bce38dc7c35cd in run42116324895. The final archive amendment contains specification/delivery records only; final-head CI is also verified before handoff.
