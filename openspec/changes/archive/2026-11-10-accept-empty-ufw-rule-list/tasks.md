## 1. Regression test

- [x] 1.1 Add executable Ansible preflight cases for exact `(None)` acceptance and mixed/unmanaged-rule rejection; run the focused test and confirm the empty-state case fails on the current task.

## 2. Fix and validation

- [x] 2.1 Update the UFW task to accept only the exact empty marker or allowed rule list; rerun the focused and full bootstrap test suites.
- [x] 2.2 Validate the OpenSpec change and run the relevant Ansible lint and syntax checks.
