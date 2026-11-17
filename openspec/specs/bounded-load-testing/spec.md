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

The operator SHALL inventory manifest-owned rows and their dependents before teardown. Teardown SHALL refuse foreign or unrecognized references, remove only owned rows in a transaction without broad cascade, and verify zero owned residues.

Completed `index_post` jobs SHALL be identified by exact kind, structured owned `postId`, and matching deduplication identity. Teardown SHALL refuse active or retryable jobs, ambiguous or mixed references, and concurrent job changes, while removing reviewed owned semantic catch-up rows and embeddings in the same transaction.

Inventory and teardown SHALL refuse more than 64 provably owned `index_post` jobs, more than 64 owned `semantic_post_catchup` rows, or more than 7 distinct indexable question/note posts in the fixture course. A cap refusal SHALL leave all fixture rows unchanged.

#### Scenario: Foreign reference

- **WHEN** a row outside the manifest refers to a fixture identity or course
- **THEN** teardown refuses deletion and reports the reference

### Requirement: Bounded backend workload

The test SHALL use ordinary HTTPS API calls, not browser automation. Each VU SHALL sign in once and retain cookie and CSRF token. Fixed selected reads are course list, feed, post detail, notifications, and unread count; the sole writer SHALL attempt question, note, answer, follow-up, poll, and vote only in the dedicated course. The smoke SHALL attempt one vote; the ramp SHALL attempt 6–17 writes, at least 30 seconds apart, within the configured four stages and at most 20 total VUs. Each attempt SHALL be reserved before sending; ambiguous outcomes SHALL not be retried. A 429 or unexpected status SHALL abort. No announcements, mentions, email, uploads, or collaboration writes SHALL occur. Each selected operation SHALL have at least one successful checked response or the run SHALL fail as incomplete, without extending duration or raising load.

#### Scenario: Complete smoke
- **WHEN** the smoke finishes with successful login, all selected reads, and a protected vote
- **THEN** it may be marked verified after fresh telemetry checks

#### Scenario: Unsafe request
- **WHEN** the writer attempts a mutation
- **THEN** it sends the ordinary authenticated cookie, CSRF token, and exact production Origin

#### Scenario: Incomplete ramp
- **WHEN** any selected read or one of the six mutation kinds lacks a successful checked response
- **THEN** the run fails without compensating traffic or a same-run retry

#### Scenario: Safety ceiling
- **WHEN** the operator configures a smaller VU or write allowance
- **THEN** the code caps the fixed stage targets and respects the configured allowance without exceeding hard ceilings

### Requirement: Correlated private telemetry

Prometheus SHALL accept remote-write only over VM loopback, reachable from Actions by a pinned-host SSH tunnel and not a public route. k6 SHALL emit fixed low-cardinality operation/testid labels without dynamic URL, IDs, emails, tokens, or content. The Grafana `Load Test Correlation` dashboard SHALL be provisioned in the `Load Tests` folder and show k6 client percentiles/rate/errors/checks/VUs/drops alongside time-aligned application HTTP, DB-client, and VM metrics. App and VM series SHALL not be presented as exclusive to the load test.

#### Scenario: Missing telemetry
- **WHEN** application, DB-client, VM, or k6 series are absent or stale
- **THEN** smoke cannot be verified and the separate ramp is blocked

### Requirement: Manual gate and evidence

A smoke and ramp SHALL require separate manual dispatches with human Grafana and Supabase Studio review in between. The workflow SHALL record UTC window, run ID, deployed SHA, normalized profile, sanitized reports, selected-flow coverage result, and cleanup status. An Actions summary alone SHALL not prove production database-server headroom or Grafana correlation.

#### Scenario: Supabase warning
- **WHEN** Studio shows an active memory or connection warning before ramp
- **THEN** the operator SHALL not dispatch ramp without a new explicit headroom/stop decision

### Requirement: Trusted Actions dispatch and profile

The test SHALL run only from separate manually dispatched smoke and ramp GitHub Actions jobs on trusted `main`, inside the `production` Environment and existing serialized production VM queue. The runner SHALL verify its checkout matches the deployed VM SHA, use pinned-host SSH, and SHALL NOT accept an arbitrary target URL or ref. It SHALL validate required `LOAD_TEST_MAX_VUS` in 1–20, four positive integer `LOAD_TEST_STAGE_MINUTES` totaling at most ten, and `LOAD_TEST_RAMP_WRITE_ATTEMPTS` in 6–17 before fixture access. Fixed code-owned ceilings, one writer, at least 30-second mutation spacing, and selected operation list SHALL remain non-overridable.

#### Scenario: Invalid configuration
- **WHEN** a required profile value is missing, malformed, or over its cap
- **THEN** the workflow refuses fixture access or load generation

#### Scenario: Untrusted ref
- **WHEN** a dispatch is not from current trusted `main` or does not match the VM deployed SHA
- **THEN** it cannot start smoke or ramp

### Requirement: VM-owned attempt and fixture lifecycle

The VM SHALL own an owner-only credential manifest and durable per-run-ID attempt state. Atomic, locked claims SHALL prevent duplicate smoke or ramp starts. A successful smoke SHALL persist its deployed SHA and normalized profile fingerprint; a later ramp SHALL require the same identity, a smoke within 30 minutes, and a distinct dispatch. Failed, cancelled, or uncertain attempts SHALL not become retryable. The workflow SHALL compare the existing GitHub `DATABASE_URL` secret with the deployed VM URL without exposing either, validate the same project reference derived from the existing Storage endpoint, and perform fixture setup/cleanup only through the privileged VM path. The ramp finalizer SHALL attempt reviewed teardown; failed smoke SHALL also attempt it, and interrupted/lost runners SHALL have a documented manual recovery path.

#### Scenario: Duplicate or changed profile
- **WHEN** a second dispatch reuses a claimed run ID or profile variables change after smoke
- **THEN** the VM refuses the claim without generating load

#### Scenario: Cleanup interrupted
- **WHEN** cancellation, worker activity, or a lost runner prevents verified cleanup
- **THEN** state and manifest remain for reviewed VM-side recovery, and the workflow does not claim success

### Requirement: Safe Actions evidence

The runner SHALL transfer the 0600 manifest only transiently over pinned SSH, keep the Prometheus remote-write tunnel private, and remove runner credentials in finalization. Only reports screened for credentials, identifiers, response bodies, and dynamic URLs SHALL become Actions artifacts. The run summary SHALL disclose selected core API coverage and excluded course creation, files, email, and collaboration flows.

#### Scenario: Unsafe report
- **WHEN** a report contains a manifest secret or dynamic private identifier
- **THEN** artifact upload is refused
