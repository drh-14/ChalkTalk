## ADDED Requirements

### Requirement: Pre-claim telemetry readiness

Before claiming a VM attempt or provisioning a fixture, the runner SHALL wait for a bounded period until the API, worker, collaboration, VM host, and VM-network scrape targets each have at least two fresh `up=1` samples. It SHALL not require application HTTP or database-client latency samples before load traffic. If readiness is not achieved, it SHALL fail with a target-specific diagnostic without consuming the run ID, creating a fixture, or generating k6 traffic.

#### Scenario: Healthy idle API

- **WHEN** all required scrape targets are fresh and healthy but no recent application HTTP or database-client latency series exist
- **THEN** pre-claim readiness succeeds without creating artificial traffic

#### Scenario: Prometheus recently restarted

- **WHEN** a required target has only one fresh successful scrape initially and reaches two within the bounded wait
- **THEN** the runner proceeds only after the second fresh sample appears

#### Scenario: Target remains unhealthy

- **WHEN** a required target remains down or lacks two fresh successful samples until the wait expires
- **THEN** the runner reports that target and does not claim or provision the fixture

### Requirement: ID-free manual load dispatches

The operator SHALL have separately named Smoke and Ramp manual workflows, neither with a run-ID input nor any automatic trigger. Smoke SHALL derive a unique valid fixture ID from its trusted GitHub Actions run identity before fixture access and disclose that ID and source workflow URL in its summary and sanitized evidence. Ramp SHALL use only VM-owned state to discover its fixture and SHALL disclose the selected fixture ID and source Smoke workflow URL. A GitHub Actions rerun attempt SHALL fail before fixture access rather than silently create another fixture or repeat load.

#### Scenario: Smoke dispatch without an ID input

- **WHEN** a trusted operator manually dispatches Smoke
- **THEN** the workflow uses a unique valid ID without asking the operator to enter or copy it

#### Scenario: Ramp dispatch without an ID input

- **WHEN** a trusted operator manually dispatches Ramp after reviewing a verified Smoke
- **THEN** Ramp selects the eligible VM-owned fixture without asking for its ID and never starts automatically

#### Scenario: Workflow rerun attempt

- **WHEN** a Smoke or Ramp Actions run is retried as a new Actions attempt
- **THEN** it is refused before fixture access or load generation

### Requirement: Singleton fixture and atomic ramp selection

The VM SHALL allow at most one globally active or uncertain load-test fixture. A new Smoke SHALL be refused while any prior fixture is claimed, verified, ramp-claimed, failed, stale, or cleanup-uncertain; only a verified cleaned state may be ignored, including a cleaned state left by the prior ID-taking workflow. After successful Smoke inventory and observability checks, the VM SHALL store the SHA-256 of the exact owner-only manifest bytes in verified state. Under one VM-side lock, Ramp SHALL discover and claim exactly one unclaimed verified Smoke no more than 30 minutes old. It SHALL validate deployed SHA, normalized profile, project/DB identity, current owner-only manifest bytes against the verified digest, and recorded smoke provenance before claiming; absence, ambiguity, stale state, missing manifest, or mismatch SHALL fail without load or state mutation. Reviewed cleanup remains the only recovery path for unresolved fixtures.

#### Scenario: Prior unresolved fixture

- **WHEN** any fixture has a state other than verified cleaned
- **THEN** a new Smoke cannot claim or provision another fixture

#### Scenario: Legacy cleaned state

- **WHEN** only correctly cleaned states from the previous workflow remain
- **THEN** they do not block a new Smoke

#### Scenario: Eligible ramp fixture

- **WHEN** exactly one recent verified Smoke matches the current SHA, profile, project/DB identity, manifest, and provenance
- **THEN** Ramp atomically claims that fixture once

#### Scenario: Ambiguous or mismatched ramp fixture

- **WHEN** no single matching fixture can be proved under the lock
- **THEN** Ramp fails before load or state mutation
