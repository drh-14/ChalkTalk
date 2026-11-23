## 1. Approval preparation

- [x] Verify exclusive clean task branch, archive original prepared HEAD and realign only this branch to latest origin/main.
- [x] Inspect current source/styles and prepare narrow proposal/design/specifications.
- [x] Validate OpenSpec and inspect actual-style current/proposed desktop/mobile mockups (strict validation passed; 1440/390/320px renders have no horizontal overflow).
- [x] Obtain user visual approval and agreement on rendered-browser test seam before product edits.

## 2. Implementation after approval

- [x] Obtain scope approval for pre-existing home mobile notification-panel clipping; prepare refreshed actual-style 390/320px mockups.
- [x] Obtain visual approval of the refreshed mobile notification-panel mockups before implementing expanded CSS.
- [x] Retain and extend mobile panel bounds/anchor assertions; reproduce RED, implement only the home-scoped width constraint, then confirm GREEN (three browser scenarios pass at 1440/390/320px).
- [x] Add observable home-header browser assertions; run against current source and confirm expected desktop width-cap failure (logo x=228, expected 20). Existing notification panel also extended 32.8px outside the mobile viewport before this change; its scoped fix was subsequently approved.
- [x] Remove only the home header width cap; rerun browser tests and confirm passing layout.
- [x] Exercise accessible home controls, default/open panels, desktop/mobile and no overflow; screenshot each scenario.
- [x] Run course-header/browser regressions and repository checks (57 final combined browser cases, including seven home/account cases, 1145 unit tests passed with 849 existing environment-dependent skips; formatting/lint/typecheck/build passed).

## 2a. New course-actions requirement

- [x] Inspect actual controls and prepare same-row desktop/mobile mockups, documenting unchanged styles and the 320px label-wrapping tradeoff.
- [x] Obtain user visual approval before button-row product changes.
- [x] Add observable row/order/gap/size/form assertions; demonstrate RED at 320px, implement only home nowrap rule, and confirm GREEN with final screenshots.

## 3. Delivery after verification

- [x] Validate and archive OpenSpec after implementation verification.
- [ ] Commit scoped work, run full no-mistakes and resolve findings.
- [ ] Ensure one final commit, draft-only new PR with uploaded screenshots, and passing exact-head CI; report to parent.
