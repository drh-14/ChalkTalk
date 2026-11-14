# Tasks

Implementation is authorized by the approved product decisions. Automated verification and gates remain deferred until the user requests them. Do not mark unverified work complete.

## 1. Unified document rendering

- [ ] 1.1 Add original/searchable document selection with explicit preparation, existing bounded pending polling, retries and downloads; verify switching preserves page/zoom and cancels obsolete requests.
- [ ] 1.2 Keep anchors tied to original; suppress unverified derived overlays and switch to original before marking/asking. Verify original file IDs and crops remain authoritative.
- [ ] 1.3 Reuse embedded extracted text layouts/progress/Download .txt, route PDF catalog text actions into the viewer, and retain non-PDF behavior. Verify catalog navigation and document/text controls together.
- [ ] 1.4 Add specification-derived unit/browser coverage for version switching, generation states, original fallback and text navigation, and update viewer documentation; execution deferred.

## 2. Reliable questions

- [ ] 2.1 Add distinct question loading, initial error/retry, successful empty and background error states. Verify PDF remains usable and old content stays visible during refresh failure.
- [ ] 2.2 Refresh every 15s while visible and on return/own post, serialize requests and fence file identity; preserve draft/page/zoom/selection and guard explicit changed-file reload. Verify via controlled async and visibility scenarios.
- [ ] 2.3 Add regression coverage and document refresh/error/replacement behavior; execution deferred.

## 3. Responsive navigation

- [ ] 3.1 Add desktop side panels and mounted mobile PDF/Questions/Extracted text tabs, measure available height and preserve page/draft while changing tabs. Verify touch marking versus scrolling and keyboard navigation.
- [ ] 3.2 Add mobile/header-wrap/browser scenarios and ignored screenshots, and document mobile behavior; execution deferred.

## 4. Deferred integration and delivery

- [ ] 4.1 When user is ready, run OpenSpec validation, typecheck, lint, affected API/unit/browser checks and capture/upload fresh screenshots. Keep failures and unverified scenarios explicit.
- [ ] 4.2 When user is ready, run no-mistakes, consolidate to one commit, lease-push and update existing draft PR175 with final evidence and CI; archive after implementation verification. Do not mark ready or merge.
