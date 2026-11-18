## Context

See proposal.md. `profile.mjs` validates the environment value before any VM claim, and its current digits-only regular expression rejects `15.0` from GitHub's number input.

## Goals / Non-Goals

Accept equivalent whole-number text without relaxing the 2–20 ceiling. Do not change the Actions form, add an environment variable, or alter fixture/load behavior.

## Decisions

- Keep validation at `normalizeProfile`, the existing pre-claim seam. Accept only digits with an optional decimal point followed by one or more zeroes; convert with `Number` and retain safe-integer/range checks. This handles the observed Actions value while rejecting fractions, exponents, signs, whitespace, and non-finite values. Rather than changing the workflow input to a string, retain its numeric UI and safety bound.
- Exercise the public profile-normalization interface with red/green Node tests for `15.0`, `10.0`, fractional and malformed cases.

## Risks / Trade-offs

- GitHub may serialize numbers differently in the future → the parser still fails closed and reports a clear input error.

## Migration Plan

Merge/deploy the parser fix before a fresh manually dispatched Ramp. Failed runs did not reach fixture claim, so no cleanup migration is needed.
