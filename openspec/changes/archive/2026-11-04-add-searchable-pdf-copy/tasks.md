## Essential specification-first checks

- [x] 1. Add narrowly scoped tests for prepare/status/dedup and authorized current-file streaming, stale generation/cleanup behavior, and one real-tool searchable page fixture; demonstrate the missing behavior before implementation. Keep broad suites deferred.

## Implementation

- [x] 2. Add derivative metadata migration and resource service/queue/status/stream logic, with protected prepare/status/view/download HTTP routes and API/OpenAPI/database reference parity.
- [x] 3. Implement bounded page rendering, Tesseract PDF generation and qpdf assembly in the existing worker extraction lane; include qpdf tool readiness, lease/generation fencing, failure handling and derivative cleanup for stale attempts, file replacement/removal and course deletion.
- [x] 4. Add the PDF-only Searchable PDF panel mode, prepare/poll/retry states, native embed and open/download fallback links; preserve compact actions, existing text/.txt modes and original download.

## Demo verification

- [x] 5. Run only essential focused checks and one mocked-API Chromium flow with screenshots; apply migration, restart demo services and generate the existing 18-page reading. Confirm complete page count, unchanged-looking rendered page, selectable/searchable article text and unchanged original/search text. Update handoff with actual results.

## Deferred delivery

- [ ] 6. After user demo testing, tighten per-field size/page-count nullness constraints with an additive migration (057 already applied; app currently writes both fields together), finish any remaining required checks, run no-mistakes, archive/sync the OpenSpec change and publish a scoped one-commit draft PR with browser evidence and final-head checks. Do not run this during demo-first work.
