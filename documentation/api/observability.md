# Local API observability

**Implementation status:** The Express API and its in-process course-deletion worker expose local-only metrics and sanitized JSON events when `OBSERVABILITY_ENABLED=true`. This is an operator endpoint, not part of the browser `/api/v1` session API. It is not a production monitoring deployment.

## `GET /metrics`

The endpoint exists only while observability is enabled. Send `Authorization: Bearer <METRICS_TOKEN>`; the token is distinct from user sessions and must be at least 32 characters when enabled. Invalid or missing tokens return `401` and no metrics. When disabled, the route returns `404`. A successful request returns Prometheus text (`200`, `Cache-Control: no-store`). No browser CORS access is configured.

`chalktalk_http_requests_total` and `chalktalk_http_request_duration_seconds` use bounded method, Express route template, status class, and completed/aborted outcome labels; unmatched requests use `_unmatched`. The duration histogram includes a 0.2-second bucket. Health and metric scrapes are excluded from application request rates. `chalktalk_jobs_total` and `chalktalk_job_duration_seconds` use fixed `delete_course` kind and success/failure outcomes. Process/Node metrics and log spool definite-drop, capacity-evicted-event, evicted-segment, and write-error counters are also exposed. No metric labels contain request URLs, query strings, request IDs, user IDs, course IDs, or content.

## Structured events

Each request completion/abort and job start/outcome is a JSON event to Docker stdout; API startup, database-pool errors, failed post-view writes, and unexpected server errors have separate event names. Events contain only a timestamp, severity, event name, and applicable request ID, method, matched route template, status, duration, completed/aborted outcome, fixed job kind and outcome, or bounded error code. The posts route may additionally include allowlisted post type/sort enums and a bounded result count on a successful post-list response. Authentication, account, and file-resource endpoints remain metadata-only. Passwords, tokens, emails, titles, Markdown, anonymous content, raw URLs, query strings, headers, file bytes, exception messages, and stack traces are never logged. Unknown routes have metadata only.

The API also writes the same sanitized events asynchronously to a named-volume NDJSON spool. Its 16 MiB segment size, 256 MiB total cap, and 7-day maximum age are finite: old unsent segments can be evicted; the newest in-memory tail can be lost on a crash; Logstash restart/replay can duplicate indexed events. The drop counter counts events rejected before persistence, including write failures. Capacity-evicted events are reported separately as **at-risk**, not confirmed loss: Logstash may already have indexed them. Routine age expiry does not increase either event counter. An unavailable collector or disk does not block application requests. This is not a lossless audit log.

Local Logstash tails the spool, persists offsets and a bounded queue, and sends to Elasticsearch. The `chalktalk-local-7d` lifecycle policy deletes indexed logs after seven days; Prometheus retains samples for 15 days. The future one-year production log requirement remains separate.
