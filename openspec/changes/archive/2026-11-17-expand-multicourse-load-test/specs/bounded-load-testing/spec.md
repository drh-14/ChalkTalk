## MODIFIED Requirements

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

### Requirement: Manual gate and evidence

Smoke and Ramp SHALL be separately manually dispatched, with human Grafana and Supabase Studio review before production Ramp. Smoke is optional, not a Ramp prerequisite. Each workflow SHALL record UTC window, generated run ID, source workflow URL, deployed SHA, normalized profile, selected-operation/per-course coverage, telemetry, cleanup, report, artifact, and email-delivery statuses separately. Actions evidence alone SHALL not prove Supabase database-server headroom or Grafana correlation.

#### Scenario: Independent Ramp dispatch
- **WHEN** an operator manually dispatches Ramp without prior Smoke
- **THEN** it may proceed after its own readiness, identity and fixture checks, if no active or cleanup-uncertain fixture exists

#### Scenario: Supabase warning
- **WHEN** Studio shows active memory or connection warning before Ramp
- **THEN** the operator SHALL not dispatch without a new explicit headroom/stop decision

### Requirement: Safe Actions evidence

The runner SHALL transiently transfer the owner-only manifest over pinned SSH, keep remote-write and report-query access private, and remove runner credentials in finalization. Only reports screened for credentials, nested fixture identifiers, response bodies, email addresses, and dynamic URLs SHALL become Actions artifacts. The run summary and scope file SHALL disclose selected ordinary-course coverage and excluded flows. The downloadable `report.html` SHALL be a self-contained HTML report with separate single-unit, single-Y-axis time-series panels from bounded run-scoped Prometheus queries; duration values SHALL display in milliseconds. The original screened k6 export MAY remain artifact-only as `k6-original.html` but SHALL NOT silently replace the custom report. Missing required series SHALL be reported as unavailable or fail report generation, not displayed as zero.

#### Scenario: Unsafe report
- **WHEN** any report contains a manifest secret or nested private identifier
- **THEN** artifact upload and email of that report are refused

#### Scenario: Missing chart series
- **WHEN** a required run-scoped series is missing
- **THEN** report generation is incomplete, while independently safe summary and original-export evidence may remain downloadable

## ADDED Requirements

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
