## Why

Ramp currently depends on a recent Smoke fixture and matching configuration, so it cannot be dispatched independently. The completed production Ramp also exposed a transient Supabase session-pool refusal during cleanup, leaving an unresolved fixture that correctly blocked later tests. Make each bounded run self-contained without weakening fixture or teardown safeguards.

## What Changes

- Give Ramp one required 2–20 maximum-concurrent-users dispatch input; generate its own unique run ID and fixture without requiring Smoke.
- Fix the four-stage ramp and selected read-heavy/bounded-write user behavior in code, with no TPS or run-ID inputs.
- Keep Smoke optional and one-user, but require verified self-cleanup on success.
- Retry only recognized pre-transaction connection-limit cleanup failures at most twice within two minutes; unresolved or ambiguous cleanup remains fail-closed.
- Preserve current telemetry, report privacy, singleton, legacy-recovery, and operator-headroom contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bounded-load-testing`: independent fixture lifecycle, manual Ramp input, session-like bounded workload, Smoke self-cleanup, and connection-limit cleanup handling.

## Impact

GitHub Actions load-test workflows; VM attempt state and fixture CLI; k6 profile/workload; run summaries and sanitized reports; operator runbook and tests. No application API or database migration. No production dispatch is part of implementation.
