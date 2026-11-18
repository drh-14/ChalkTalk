## Why

GitHub Actions serializes the Ramp workflow's numeric input as values such as `15.0`. The runner rejects that representation before fixture claim, even though the operator selected a valid whole-number user limit.

## What Changes

- Accept decimal representations with a zero-only fractional part for the 2–20 maximum-user input.
- Continue rejecting fractional values, malformed strings, and out-of-range limits before fixture claim.
- Add a regression test for the actual Actions environment value.

## Capabilities

### Modified Capabilities

- `bounded-load-testing`: Clarify accepted serialization of the strict whole-number Ramp input.

## Impact

Only the Ramp profile parser and its tests change. No workflow inputs, load limits, fixture state, dependencies, or production dispatch are changed.
