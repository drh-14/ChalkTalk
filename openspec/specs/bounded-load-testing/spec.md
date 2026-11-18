# bounded-load-testing Specification

## Purpose

Define the safety, telemetry, and cleanup contracts for the manually operated production k6 test.

## Requirements

### Requirement: Fail-closed production fixture

The operator SHALL provision only uniquely namespaced synthetic verified accounts, an organization, dedicated course, memberships, and prerequisite content through a privileged CLI. The CLI SHALL require an explicit production acknowledgment, exact expected Supabase project host/ref, unique run ID, and deployed SHA, and SHALL not fall back to a generic database environment variable. It SHALL reject reused namespace or target mismatch before writes, commit provisioning atomically, produce credentials in an owner-only file, and send no fixture email.

#### Scenario: Incorrect target or reused run

- **WHEN** the expected project identity differs from the connection target or the run namespace exists
- **THEN** provisioning refuses to mutate the database

#### Scenario: Partial provisioning failure

- **WHEN** any fixture insert fails
- **THEN** no fixture rows remain committed

### Requirement: Reviewed fixture cleanup

The operator SHALL inventory manifest-owned rows and their dependents before teardown. Teardown SHALL refuse foreign or unrecognized references, remove only owned rows in a transaction without broad cascade, and verify zero owned residues. Completed `index_post` jobs SHALL be identified by exact kind, structured owned `postId`, and matching deduplication identity. Teardown SHALL refuse active or retryable jobs, ambiguous or mixed references, and concurrent job changes, while removing reviewed owned semantic catch-up rows and embeddings in the same transaction. Inventory and teardown SHALL refuse more than 64 provably owned `index_post` jobs, more than 64 owned `semantic_post_catchup` rows, or more than 7 distinct indexable question/note posts in the fixture course. A cap refusal SHALL leave all fixture rows unchanged. When inventory or teardown fails specifically to acquire a database connection because of a recognized session/client limit before any transaction can mutate data, finalization MAY wait for traffic to quiesce and make at most two additional attempts within two minutes, re-inventorying and rechecking dependencies before any teardown retry. Ambiguous transaction outcomes, changed inventory, unknown references, or exhausted retries SHALL remain cleanup-uncertain and block later tests.

#### Scenario: Foreign reference
- **WHEN** a row outside the manifest refers to a fixture identity or course
- **THEN** teardown refuses deletion and reports the reference

#### Scenario: Connection-limit cleanup refusal
- **WHEN** a fixture command cannot acquire a database connection before a transaction because of a recognized pooler limit
- **THEN** finalization retries at most twice within two minutes, with reviewed inventory before teardown, and marks cleaned only after verified zero residue

#### Scenario: Uncertain cleanup outcome
- **WHEN** a transaction may have committed or inventory changes unexpectedly
- **THEN** the attempt remains consumed and cleanup-uncertain without an automatic teardown retry

### Requirement: Bounded backend workload

The test SHALL use ordinary HTTPS API calls, not browser automation. Each VU SHALL sign in once and retain cookie and CSRF token. Smoke SHALL use one VU for the selected reads and one protected vote. Ramp SHALL use one dedicated bounded writer and read-only VUs for session-like browsing of course list, feed, post detail, notifications, and unread count, with bounded think pauses. The sole writer SHALL attempt question, note, answer, follow-up, poll, and vote only in the dedicated course. Ramp SHALL attempt no more than 17 writes, at least 30 seconds apart, in four code-owned stages of 1, 3, 3, and 3 minutes with total-VU targets 2, 5, 10, and 20 capped by the operator's 2–20 maximum. Each write attempt SHALL be reserved before sending; ambiguous outcomes SHALL not be retried. A 429 or unexpected status SHALL abort. No announcements, mentions, email, uploads, or collaboration writes SHALL occur. Every selected read and write kind SHALL have a successful checked response or the run SHALL fail as incomplete without extending duration or raising load. Actual throughput SHALL be reported, not accepted as a TPS input or promised by the maximum-user setting.

#### Scenario: Complete Ramp
- **WHEN** Ramp finishes within limits with all five selected reads and six mutation kinds checked successfully
- **THEN** workload coverage is complete, subject to telemetry and cleanup verification

#### Scenario: Complete smoke
- **WHEN** Smoke finishes with successful login, all selected reads, and a protected vote
- **THEN** it may proceed to fresh telemetry checks and reviewed cleanup

#### Scenario: Unsafe request
- **WHEN** the writer attempts a mutation
- **THEN** it sends the ordinary authenticated cookie, CSRF token, and exact production Origin

#### Scenario: Incomplete ramp
- **WHEN** any selected read or one of the six mutation kinds lacks a successful checked response
- **THEN** the run fails without compensating traffic or a same-run retry

#### Scenario: Safety ceiling
- **WHEN** the operator configures a smaller maximum user count
- **THEN** code caps fixed stage targets and preserves its write and duration ceilings

#### Scenario: Maximum user input
- **WHEN** the operator selects a maximum between 2 and 20
- **THEN** Ramp starts with one writer and one reader, caps its four stage targets at that maximum, and never exceeds it

#### Scenario: Incomplete or unsafe workload
- **WHEN** a selected operation is absent, a mutation outcome is ambiguous, or an unexpected status or 429 occurs
- **THEN** the run fails or aborts within its existing duration and write ceiling

### Requirement: Correlated private telemetry

Prometheus SHALL accept remote-write only over VM loopback, reachable from Actions by a pinned-host SSH tunnel and not a public route. k6 SHALL emit fixed low-cardinality operation/testid labels without dynamic URL, IDs, emails, tokens, or content. The Grafana `Load Test Correlation` dashboard SHALL be provisioned in the `Load Tests` folder and show k6 client percentiles/rate/errors/checks/VUs/drops alongside time-aligned application HTTP, DB-client, and VM metrics. App and VM series SHALL not be presented as exclusive to the load test. Both Smoke and independent Ramp SHALL require fresh application, DB-client, VM, and run-tagged k6 series after their own traffic before claiming telemetry verification.

#### Scenario: Missing telemetry
- **WHEN** required application, DB-client, VM, or run-tagged k6 series are absent or stale after traffic
- **THEN** that run fails telemetry verification and cannot claim success

### Requirement: Manual gate and evidence

Smoke and Ramp SHALL be separately and manually dispatched, with human Grafana and Supabase Studio review before a production Ramp. Smoke is optional and SHALL NOT be a prerequisite for Ramp. Each workflow SHALL record its UTC window, generated run ID, source workflow URL, deployed SHA, normalized profile, sanitized reports, selected-flow coverage result, and cleanup status. An Actions summary alone SHALL not prove production database-server headroom or Grafana correlation.

#### Scenario: Independent Ramp dispatch
- **WHEN** an operator manually dispatches Ramp without a prior Smoke
- **THEN** it may proceed after its own readiness checks and fresh fixture claim, provided no active or cleanup-uncertain fixture exists

#### Scenario: Supabase warning
- **WHEN** Studio shows an active memory or connection warning before Ramp
- **THEN** the operator SHALL not dispatch Ramp without a new explicit headroom/stop decision

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

### Requirement: VM-owned attempt and fixture lifecycle

The VM SHALL own an owner-only credential manifest and durable per-run-ID attempt state. Atomic locked claims SHALL prevent duplicate or overlapping Smoke or Ramp starts. Each workflow SHALL derive its own unique ID from trusted first-attempt Actions run identity, validate deployed SHA, project and database identity, and normalized effective profile, then provision its own bounded synthetic fixture. Smoke SHALL perform reviewed teardown and verified zero-residue cleanup on success as well as failure; Ramp SHALL do the same after its own traffic. A successful Smoke SHALL NOT retain a fixture for Ramp, and Ramp SHALL NOT claim a Smoke fixture. Failed, cancelled, or uncertain attempts SHALL never become retryable under their old ID. The workflow SHALL compare the existing GitHub `DATABASE_URL` secret with the deployed VM URL without exposing either, validate the same project reference derived from the existing Storage endpoint, and perform fixture setup/cleanup only through the privileged VM path. Interrupted or lost runners SHALL have a documented manual recovery path. Legacy cleaned states MAY coexist, but any active, uncertain, malformed, or orphaned legacy state SHALL block new claims until reviewed recovery.

#### Scenario: Successful Smoke cleanup
- **WHEN** Smoke completes its checked workload and telemetry verification
- **THEN** it inventories and tears down its own fixture, verifies zero residue, and marks its state cleaned

#### Scenario: Fresh Ramp claim
- **WHEN** a trusted Ramp dispatch starts with no active or uncertain fixture
- **THEN** it atomically claims a fresh unique ID, provisions its own fixture, and does not require a previous Smoke

#### Scenario: Unresolved prior fixture
- **WHEN** any prior fixture remains active, stale, failed, or cleanup-uncertain
- **THEN** either workflow refuses a fresh claim before provisioning or traffic

#### Scenario: Duplicate or changed profile
- **WHEN** a dispatch reuses a claimed run identity or its effective profile does not match its recorded state
- **THEN** the VM refuses the attempt without generating load

#### Scenario: Cleanup interrupted
- **WHEN** cancellation, worker activity, or a lost runner prevents verified cleanup
- **THEN** state and manifest remain for reviewed VM-side recovery, and the workflow does not claim success

### Requirement: Safe Actions evidence

The runner SHALL transfer the 0600 manifest only transiently over pinned SSH, keep the Prometheus remote-write tunnel private, and remove runner credentials in finalization. Only reports screened for credentials, identifiers, response bodies, and dynamic URLs SHALL become Actions artifacts. The run summary SHALL disclose selected core API coverage and excluded course creation, files, email, and collaboration flows.

#### Scenario: Unsafe report

- **WHEN** a report contains a manifest secret or dynamic private identifier
- **THEN** artifact upload is refused

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

The operator SHALL have separately named manual Smoke and Ramp workflows with no automatic trigger or run-ID input. Smoke SHALL have no inputs; Ramp SHALL have only the required maximum-concurrent-users input. Each SHALL generate a unique valid fixture ID from its own trusted GitHub Actions run identity, disclose the ID and source workflow URL in its summary and sanitized evidence, and reject a GitHub Actions rerun attempt before fixture access.

#### Scenario: Independent Ramp without run ID
- **WHEN** a trusted operator dispatches Ramp with a valid maximum-user input
- **THEN** it generates its own unique run ID and fixture without asking for a Smoke run or an ID

#### Scenario: Smoke dispatch without an ID input
- **WHEN** a trusted operator manually dispatches Smoke
- **THEN** the workflow uses a unique valid ID without asking the operator to enter or copy it

#### Scenario: Ramp dispatch without an ID input
- **WHEN** a trusted operator manually dispatches Ramp
- **THEN** Ramp generates a unique valid ID without asking for a previous Smoke ID

#### Scenario: Workflow rerun attempt
- **WHEN** an Actions run is retried as a new attempt
- **THEN** it is refused before fixture access or load generation

### Requirement: Singleton fixture and atomic ramp selection

The VM SHALL allow at most one globally active or uncertain load-test fixture. Under one VM-side lock, either workflow SHALL create a fresh one-time attempt only when every prior state is correctly cleaned and no orphan manifest or per-run database URL exists. The claim SHALL validate deployed SHA, normalized profile, project/DB identity, and source-run provenance before state mutation. Once provisioned, the workflow SHALL record and verify the SHA-256 of exact owner-only manifest bytes before traffic. Ramp SHALL NOT select or reuse a previous Smoke fixture. Missing or mismatched manifest, stale identity, ambiguity, or any unresolved legacy state SHALL fail closed; reviewed cleanup remains the only recovery path.

#### Scenario: Only cleaned history remains
- **WHEN** only verified cleaned states from current or legacy workflows remain
- **THEN** an independent Ramp or Smoke may make a fresh one-time claim

#### Scenario: Prior unresolved fixture
- **WHEN** any fixture has a state other than verified cleaned
- **THEN** a new Smoke or Ramp cannot claim or provision another fixture

#### Scenario: Legacy cleaned state
- **WHEN** only correctly cleaned states from a previous workflow remain
- **THEN** they do not block a new independent attempt

#### Scenario: Eligible ramp fixture
- **WHEN** Ramp passes preflight and all previous states are cleaned
- **THEN** it atomically claims its own new fixture once

#### Scenario: Ambiguous or mismatched ramp fixture
- **WHEN** any existing state, manifest, or identity cannot be proved safe
- **THEN** Ramp fails before load or state mutation

#### Scenario: Ambiguous or mismatched fixture
- **WHEN** a current manifest, project identity, or state cannot be proven under the VM lock
- **THEN** the workflow refuses claim or load without silently reusing it
