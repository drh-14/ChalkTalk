## 1. Reconcile approved compatibility
- [x] 1.1 Resolve mechanical conflicts preserving semantic and upstream behavior.
- [x] 1.2 Add HTTP visibility/member/pagination/poll tests and worker eligibility tests, and run RED.
- [x] 1.3 Implement eligibility filtering; run focused and full checks GREEN.
- [x] 1.4 Archive the verified compatibility specification; deliver the existing draft PR51 through the separate required gate and one-commit publication workflow.

Local evidence: expected poll RED failures, then 30 focused real-vector GREEN tests; full suite 941 passed / 2 existing skips, typecheck/lint/format/build passed, and mocked Chromium desktop/mobile question+note flows passed. Publication remains independently gated.
