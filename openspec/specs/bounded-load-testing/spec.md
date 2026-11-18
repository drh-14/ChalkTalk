# bounded-load-testing Specification

## Purpose

Define the safety, telemetry, and cleanup contracts for the manually operated production k6 test.

## Requirements

### Requirement: Fail-closed production fixture

The operator SHALL provision only uniquely namespaced synthetic verified accounts, an organization, memberships, and prerequisite content through a privileged CLI. Smoke SHALL retain its one-course, 20-account fixture. Ramp SHALL provision exactly three isolated courses and 30 accounts, each assigned to one course and role, with seeded public posts, polls, Thread boards, and external-link resource metadata. The CLI SHALL require explicit production acknowledgment, exact expected Supabase project host/ref, unique run ID, and deployed SHA, SHALL not fall back to a generic database environment variable, SHALL reject reused namespace or target mismatch before writes, SHALL commit provisioning atomically, SHALL keep credentials in an owner-only manifest, and SHALL send no fixture email.

#### Scenario: Incorrect target or reused run
- **WHEN** expected project identity differs from the connection target or the run namespace exists
- **THEN** provisioning refuses without mutating the database

#### Scenario: Partial provisioning failure
- **WHEN** any fixture insert fails
- **THEN** no fixture rows remain committed

#### Scenario: Ramp cohorts
- **WHEN** Ramp provisioning succeeds
- **THEN** its owner-only manifest identifies exactly three courses, 30 distinct synthetic users, their course roles, and owned seed content

### Requirement: Reviewed fixture cleanup

The operator SHALL inventory manifest-owned rows and dependents before teardown. Teardown SHALL refuse foreign or unrecognized references, remove only owned rows in one transaction without relying on broad cascades, and verify zero owned residues. This SHALL include Ramp-owned Thread board, conversation, message, watch, read, notification, change and counter rows, and resource catalog/link rows. Non-FK Thread change references SHALL be explicitly proved owned. Per-family row caps SHALL bound content and fan-out, including at most 12 Ramp-created posts, six answers, six follow-ups, six votes, six Thread conversations, 12 Thread replies, and separately bounded watch/read/notification/change rows. Completed `index_post` jobs SHALL be identified by exact kind, structured owned `postId`, and matching deduplication identity. Teardown SHALL refuse active/retryable or unexpected jobs, mixed references, changed inventory, or exceeded caps. A cap refusal SHALL leave all rows unchanged. When a fixture command fails to acquire a database connection due to a recognized session/client limit before transaction mutation, finalization MAY make at most two further attempts within two minutes, re-inventorying before any retry. Ambiguous outcomes SHALL remain cleanup-uncertain and block later tests.

#### Scenario: Foreign reference
- **WHEN** a row outside the manifest references a fixture identity, course, Thread entity, or resource
- **THEN** teardown refuses deletion and reports the reference

#### Scenario: Fan-out or content cap
- **WHEN** an owned row family exceeds its reviewed cap
- **THEN** teardown refuses without deleting fixture rows

#### Scenario: Verified cleanup
- **WHEN** reviewed teardown completes
- **THEN** a fresh inventory proves zero owned residues before the VM marks the attempt cleaned

#### Scenario: Connection-limit cleanup refusal
- **WHEN** a fixture command cannot acquire a database connection before a transaction because of a recognized pooler limit
- **THEN** finalization retries at most twice within two minutes, with reviewed inventory before teardown, and marks cleaned only after verified zero residue

#### Scenario: Uncertain cleanup outcome
- **WHEN** a transaction may have committed or inventory changes unexpectedly
- **THEN** the attempt remains consumed and cleanup-uncertain without an automatic teardown retry

### Requirement: Bounded backend workload

The test SHALL use ordinary authenticated HTTPS API requests, not browser automation. Each active VU SHALL sign in once and keep its cookie and CSRF token. Smoke SHALL remain a one-VU selected-read and protected-vote readiness check. Ramp SHALL allow one operator maximum from 10 through 30 active users, rise gradually within ten minutes, and distribute active synthetic users across three course cohorts. Ramp SHALL simulate bounded session-like browsing of course list, feeds, returned post details, notifications, Thread boards/conversations/messages and live signals, and resource metadata/search with think pauses. It SHALL generate at most 12 new posts (four per course), six answers, six follow-ups, six votes, six Thread conversations and 12 replies; watch/read-state attempts SHALL have explicit separate caps. Every intentional write-request start, including login, SHALL be at least five seconds after the preceding intentional write-request start globally. Missed write opportunities SHALL be skipped, not bunched or retried. Every selected operation SHALL have at least one successful checked response per run; post and Thread activity SHALL be represented in every course. A missing required operation SHALL make coverage incomplete without extending time or raising load. Ambiguous write outcomes SHALL not be retried. Unexpected statuses and 429 SHALL abort. No signup/email, course administration, uploads/OCR/download bytes, destructive operations, or collaboration load SHALL occur. Actual throughput SHALL be reported, not accepted as an input or promised by the user ceiling.

#### Scenario: Complete Ramp
- **WHEN** the bounded Ramp finishes and all required operations and three course cohorts have successful checked activity
- **THEN** coverage is complete subject to telemetry and cleanup verification

#### Scenario: Complete smoke
- **WHEN** Smoke finishes with successful login, all selected reads, and a protected vote
- **THEN** it may proceed to fresh telemetry checks and reviewed cleanup

#### Scenario: Late actor
- **WHEN** an actor reaches a reserved write slot too late to preserve the global floor
- **THEN** it skips that attempt without catch-up and required coverage fails if no other successful attempt fulfills it

#### Scenario: Unsafe request
- **WHEN** an actor sends a write
- **THEN** it sends the ordinary authenticated cookie, CSRF token when required, and exact production Origin

#### Scenario: Maximum input
- **WHEN** Ramp receives a valid maximum from 10 through 30
- **THEN** it starts below that maximum, ramps gradually, and never exceeds it

#### Scenario: Maximum user input
- **WHEN** the operator selects a maximum between 10 and 30
- **THEN** Ramp caps its code-owned stage targets at that maximum and never exceeds it

#### Scenario: Safety ceiling
- **WHEN** the operator configures a smaller valid maximum
- **THEN** code caps stage targets and preserves write, pacing, and duration ceilings

#### Scenario: Incomplete ramp
- **WHEN** any selected operation or required course distribution lacks a successful checked response
- **THEN** the run fails without compensating traffic or a same-run retry

#### Scenario: Incomplete or unsafe workload
- **WHEN** a required operation is absent, mutation outcome is ambiguous, or an unexpected status or 429 occurs
- **THEN** the run fails or aborts within its existing duration and safety ceilings

### Requirement: Correlated private telemetry

Prometheus SHALL accept remote-write only over VM loopback, reachable from Actions by a pinned-host SSH tunnel and not a public route. k6 SHALL emit fixed low-cardinality operation/testid labels without dynamic URL, IDs, emails, tokens, or content. The Grafana `Load Test Correlation` dashboard SHALL be provisioned in the `Load Tests` folder and show k6 client percentiles/rate/errors/checks/VUs/drops alongside time-aligned application HTTP, DB-client, and VM metrics. App and VM series SHALL not be presented as exclusive to the load test. Both Smoke and independent Ramp SHALL require fresh application, DB-client, VM, and run-tagged k6 series after their own traffic before claiming telemetry verification.

#### Scenario: Missing telemetry
- **WHEN** required application, DB-client, VM, or run-tagged k6 series are absent or stale after traffic
- **THEN** that run fails telemetry verification and cannot claim success

### Requirement: Manual gate and evidence

Smoke and Ramp SHALL be separately manually dispatched, with human Grafana and Supabase Studio review before production Ramp. Smoke is optional, not a Ramp prerequisite. Each workflow SHALL record UTC window, generated run ID, source workflow URL, deployed SHA, normalized profile, selected-operation/per-course coverage, telemetry, cleanup, report, artifact, and email-delivery statuses separately. Actions evidence alone SHALL not prove Supabase database-server headroom or Grafana correlation.

#### Scenario: Independent Ramp dispatch
- **WHEN** an operator manually dispatches Ramp without prior Smoke
- **THEN** it may proceed after its own readiness, identity and fixture checks, if no active or cleanup-uncertain fixture exists

#### Scenario: Supabase warning
- **WHEN** Studio shows active memory or connection warning before Ramp
- **THEN** the operator SHALL not dispatch without a new explicit headroom/stop decision

### Requirement: Trusted Actions dispatch and profile

The test SHALL run only from separately named manual Smoke and Ramp GitHub Actions workflows on trusted `main`, in the `production` Environment and existing serialized VM queue. The runner SHALL verify checkout and deployed VM SHA, use pinned-host SSH, and SHALL NOT accept arbitrary target URLs or refs. Ramp SHALL require exactly one manual input, `max_concurrent_users`, a strict whole-number value from 10 through 30; Smoke SHALL have no inputs. Neither workflow SHALL accept a run ID or TPS. Stage durations, stage targets, write caps and pacing, operation list, and email recipient SHALL be code-owned and non-overridable by Environment variables or dispatch inputs.

#### Scenario: Invalid Ramp input
- **WHEN** `max_concurrent_users` is missing, malformed, or outside 10–30
- **THEN** Ramp refuses before fixture claim or load generation

#### Scenario: Valid Actions numeric serialization
- **WHEN** the operator selects 15 maximum users and Actions supplies `15.0`
- **THEN** Ramp normalizes the profile to 15 maximum users before readiness and fixture checks

#### Scenario: Invalid configuration
- **WHEN** a required code-owned profile value is invalid or a supplied maximum exceeds its cap
- **THEN** the workflow refuses fixture access or load generation

#### Scenario: Untrusted ref
- **WHEN** dispatch is not from current trusted `main` or does not match the VM deployed SHA
- **THEN** it cannot start load generation

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

The runner SHALL transiently transfer the owner-only manifest over pinned SSH, keep remote-write and report-query access private, and remove runner credentials in finalization. Only reports screened for credentials, nested fixture identifiers, response bodies, email addresses, and dynamic URLs SHALL become Actions artifacts. The run summary and scope file SHALL disclose selected ordinary-course coverage and excluded flows. The downloadable `report.html` SHALL be a self-contained HTML report with separate single-unit, single-Y-axis time-series panels from bounded run-scoped Prometheus queries; duration values SHALL display in milliseconds. The original screened k6 export MAY remain artifact-only as `k6-original.html` but SHALL NOT silently replace the custom report. Missing required series SHALL be reported as unavailable or fail report generation, not displayed as zero.

#### Scenario: Unsafe report
- **WHEN** any report contains a manifest secret or nested private identifier
- **THEN** artifact upload and email of that report are refused

#### Scenario: Missing chart series
- **WHEN** a required run-scoped series is missing
- **THEN** report generation is incomplete, while independently safe summary and original-export evidence may remain downloadable

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

### Requirement: Sanitized post-cleanup report delivery

After verified zero-residue fixture cleanup and a durable cleaned-state receipt, the workflow SHALL send one email to the fixed recipient `darrenh1134@gmail.com` containing only individually attached, sanitized `report.html`, `summary.json`, `coverage.json`, and `scope.json`. It SHALL use the existing production Resend credential and checked-in sender, validate exact filenames, regular files, identity, MIME and aggregate size, and SHALL never send manifests, raw logs, tokens or the original combined k6 export. An uncertain provider response SHALL not be automatically retried. Delivery status SHALL be distinct from traffic, cleanup, report, and artifact outcomes. Email failure SHALL NOT turn a passing load test into a failing load test, hide cleanup uncertainty, or trigger a production rerun.

#### Scenario: Cleaned fixture and safe report
- **WHEN** zero residue and all four screened bounded reports are verified
- **THEN** one email is attempted with exactly those four unzipped attachments

#### Scenario: Uncertain cleanup
- **WHEN** cleanup cannot be proven, or the cleanup receipt is absent
- **THEN** report email is not attempted even if report files exist

#### Scenario: Delivery failure
- **WHEN** Resend rejects or times out after a verified-cleaned test
- **THEN** delivery records failed or unknown separately and safe artifacts remain available without another load run
