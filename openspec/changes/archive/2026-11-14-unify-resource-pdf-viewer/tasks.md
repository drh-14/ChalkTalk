# Tasks

Implementation is authorized by the approved product decisions. Automated verification and gates remain deferred until the user requests them. Do not mark unverified work complete.

## 1. Unified document rendering

- [x] 1.1 Add original/searchable document selection with explicit preparation, existing bounded pending polling, retries and downloads; verify switching preserves page/zoom and cancels obsolete requests.
- [x] 1.2 Keep anchors tied to original; suppress unverified derived overlays and switch to original before marking/asking. Verify original file IDs and crops remain authoritative.
- [x] 1.3 Reuse embedded extracted text layouts/progress/Download .txt, route PDF catalog text actions into the viewer, and retain non-PDF behavior. Verify catalog navigation and document/text controls together.
- [x] 1.4 Add specification-derived unit/browser coverage for version switching, generation states, original fallback and text navigation, and update viewer documentation; execution deferred.

## 2. Reliable questions

- [x] 2.1 Add distinct question loading, initial error/retry, successful empty and background error states. Verify PDF remains usable and old content stays visible during refresh failure.
- [x] 2.2 Refresh every 15s while visible and on return/own post, serialize requests and fence file identity; preserve draft/page/zoom/selection and guard explicit changed-file reload. Verify via controlled async and visibility scenarios.
- [x] 2.3 Add regression coverage and document refresh/error/replacement behavior; execution deferred.

## 3. Responsive navigation

- [x] 3.1 Add desktop side panels and mounted mobile PDF/Questions/Extracted text tabs, measure available height and preserve page/draft while changing tabs. Verify touch marking versus scrolling and keyboard navigation.
- [x] 3.2 Add mobile/header-wrap/browser scenarios and ignored screenshots, and document mobile behavior; execution deferred.

## 4. Deferred integration and delivery

- [x] 4.1 When user is ready, run OpenSpec validation, typecheck, lint, affected API/unit/browser checks and capture/upload fresh screenshots. Keep failures and unverified scenarios explicit.
- [x] 4.2 When user is ready, run no-mistakes, consolidate to one commit, lease-push and update independent draft PR240 with final evidence and CI; archive after implementation verification. Do not mark ready or merge.

## Verification notes

Before the gate: 76 focused web unit tests plus a route case, 114 PostgreSQL post/anchor/privacy tests, production builds, and the full mocked browser suite (117 scenarios) passed. The no-mistakes gate then passed review, test, documentation and lint after fixing render errors from released documents, dead text-layout code, and test typing and formatting. Its test step covered the Chromium viewer flows, migration 060 on fresh and upgraded databases, and the anchor API suite.

On the final commit rebased onto main: both type checks, ESLint, Prettier and strict OpenSpec validation passed. The mocked browser suite passed 117 of 118 scenarios. The one failure, a Collaboration-tab timeout, passed 4 of 4 when rerun alone. Focused web unit tests passed 384 of 388. Two failures are the Windows password-reset cases that also fail on main. The other two are 5-second timing failures in posts/views.test.tsx, and main fails the same file with 3 failures in this environment. Final CI on the pushed head is recorded on PR240.
