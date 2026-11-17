## ADDED Requirements

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

The test SHALL use ordinary HTTPS API calls and no browser automation. It SHALL sign each VU in once, retain its session cookie and CSRF token, send exact Origin on unsafe calls, perform course/feed/post and notification reads, and limit writes to question, note, answer, followup, poll, and vote in the dedicated course. The first ramp SHALL not exceed 20 total VUs or approximately ten minutes; writes SHALL not exceed 18 mutations or occur more frequently than once per 30 seconds. It SHALL reject 429 and unexpected statuses and SHALL not create announcements, mentions, email, uploads, or collaboration writes.

Each mutation SHALL reserve its attempt and timestamp before the HTTP request. A timeout, network failure, unexpected response, or unusable mutation result SHALL stop further writes rather than retry an outcome that may have committed.

The 18-mutation ceiling SHALL apply to each k6 invocation, not cumulatively across manifest copies. The runner-local ledger SHALL atomically consume at most one smoke start and one ramp start for that copy before either workload begins, serialize concurrent invocations of that copy, and refuse local retries after failed or partial attempts or missing/corrupt ledger state. Recopying the original VM manifest can reset that local guard; operators SHALL NOT recopy or rerun an attempted fixture and SHALL provision a fresh fixture and run ID instead.

#### Scenario: Unsafe request

- **WHEN** a writer makes a mutation
- **THEN** it sends the normal authenticated cookie, CSRF token, and production Origin

#### Scenario: Safety ceiling

- **WHEN** the operator starts the standard ramp
- **THEN** configured VUs, duration, and mutations remain within the fixed bounds regardless of unrelated environment variables

### Requirement: Correlated private telemetry

Prometheus SHALL accept remote-write only over VM loopback, reachable by an operator SSH tunnel and not by a public route. k6 SHALL emit fixed low-cardinality operation/testid labels without URL, IDs, emails, tokens, or content. Grafana SHALL show k6 client latency percentiles, rate, failures/checks, VUs and dropped iterations alongside time-aligned application HTTP/DB-client metrics and VM CPU, memory, network, disk, and filesystem metrics. The dashboard SHALL distinguish client, application, and VM signals and SHALL not imply app/VM samples are exclusively caused by k6.

#### Scenario: Missing telemetry

- **WHEN** application, DB-client, VM, or k6 series are absent or stale in preflight
- **THEN** the operator does not proceed to the production ramp

### Requirement: Manual gate and evidence

The run SHALL be manual, preceded by a one-VU smoke and healthy baseline, monitored for 429, unexpected errors, sustained 5xx, pool/memory/disk pressure, and Supabase warnings, and stopped on a safety signal. It SHALL retain UTC window, deployed SHA, run ID, k6 HTML/summary, dashboard evidence, manual Studio observations, and cleanup inventory. A local k6 report alone SHALL not prove Grafana correlation.

#### Scenario: Supabase warning

- **WHEN** Studio shows an active memory warning before the run
- **THEN** the ramp is blocked pending an explicit headroom/stop decision
