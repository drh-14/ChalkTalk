## 1. Specification-driven coverage

- [x] 1.1 Add browser assertions for search placement/size/focus/clear, differentiated staff notices, mobile controls and recoverable error, retaining existing draft/highlight/permission scenarios. Run before implementation to demonstrate missing behavior (desktop/mobile placement assertions failed as expected).

## 2. Resources presentation

- [x] 2.1 Move search before creation tools, reuse the existing themed search field and add accessible clear/focus restoration (nine browser flows passed, including draft restoration).
- [x] 2.2 Theme Resources inputs/selects/actions, extraction notices and loading/empty/error feedback without changing catalog operations (desktop/mobile, notice and retry assertions passed).

## 3. Verification and delivery

- [x] 3.1 Run focused component and Chromium scenarios, inspect desktop/mobile screenshots, and run format/lint/typecheck/build and strict OpenSpec validation (23 component tests, nine final Chromium scenarios, both builds and typecheck passed; gate review plus 17 browser scenarios and lint passed).
- [x] 3.2 Run Codex no-mistakes, preserve any fixes, squash to one commit, publish a draft PR with screenshots and verify final-head CI.
- [ ] 3.3 Archive after merge.
