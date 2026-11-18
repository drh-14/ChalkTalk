## MODIFIED Requirements

### Requirement: Trusted Actions dispatch and profile

The test SHALL run only from separately named, manually dispatched Smoke and Ramp GitHub Actions workflows on trusted `main`, inside the `production` Environment and existing serialized production VM queue. The runner SHALL verify its checkout matches the deployed VM SHA, use pinned-host SSH, and SHALL NOT accept an arbitrary target URL or ref. Ramp SHALL require exactly one manual input, `max_concurrent_users`, a strict whole-number value from 2 through 20. The runner SHALL accept an integer string or GitHub Actions' numeric serialization with a zero-only fractional part, such as `15.0`, as the same whole-number limit. Smoke SHALL have no inputs. Neither workflow SHALL accept a run ID or TPS. Stage durations, capped stage targets, write-attempt ceiling, one writer, at least 30-second mutation spacing, and selected operation list SHALL be code-owned and non-overridable by Environment variables or dispatch inputs.

#### Scenario: Valid Actions numeric serialization
- **WHEN** the operator selects 15 maximum users and Actions supplies `15.0`
- **THEN** Ramp normalizes the profile to 15 maximum users before its readiness and fixture checks

#### Scenario: Invalid Ramp input
- **WHEN** `max_concurrent_users` is missing, malformed, fractional, or outside 2–20
- **THEN** Ramp refuses before fixture claim or load generation

#### Scenario: Invalid configuration
- **WHEN** a required code-owned profile value is invalid or a supplied maximum exceeds its cap
- **THEN** the workflow refuses fixture access or load generation

#### Scenario: Untrusted ref
- **WHEN** a dispatch is not from current trusted `main` or does not match the VM deployed SHA
- **THEN** it cannot start Smoke or Ramp
