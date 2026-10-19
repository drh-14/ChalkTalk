## 1. Tests first
- [x] Add failing API, persistence, UI, and browser assertions for answer-only live editing and rendered save transitions.

## 2. Implementation
- [x] Remove followup live API/WebSocket/store/migration paths while preserving conditional REST edits.
- [x] Open followup and reply editors directly as REST composers; ensure saved bodies render Markdown/LaTeX.
- [x] Update API references and active OpenSpec contracts.

## 3. Verification and delivery
- [x] Run focused and full checks, answer-only two-node/full-stack and mocked browser scenarios with screenshots.
- [x] Archive OpenSpec change, run no-mistakes, squash to one commit, lease-push draft PR #50, and verify final CI.
