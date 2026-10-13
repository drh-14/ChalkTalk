## 1. Behavior

- [x] 1.1 Update the statistics view test to expect “No answers” in the metric value class, and confirm the previous display fails the test before implementation.
- [x] 1.2 Render the null response time as “No answers” in the shared metric style and clarify its caption; verify focused tests pass and numeric metrics retain their current styling.

## 2. Verification and delivery

- [x] 2.1 Run formatting, focused lint, typecheck, and relevant tests; verify all pass.
- [x] 2.2 Exercise the empty and numeric response-time states in a real browser with mocked API responses, capture a screenshot for each, and verify both values' computed styles match.
- [x] 2.3 Validate the OpenSpec change and verify its delta describes the new display.
- [x] 2.4 Inspect the saved browser screenshots and verify that the numeric response-time state retains its original appearance.
