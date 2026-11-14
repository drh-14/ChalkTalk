## Approach

Keep the existing PromQL and seconds unit. Move the database targets to the matching HTTP panels and label each database series with its measurement and process. The curves represent independent distributions over the same five-minute window. Leave p99 HTTP latency available.

Add three endpoint charts using existing HTTP method and matched-route labels for login, course creation, and notification fetching. Request-scoped, fixed-operation database totals supply matching query and pool-acquisition p50/p95 series; the notification chart distinguishes list and unread-count fetches. Follow the approved architecture in `documentation/design/2026-11-13-endpoint-db-latency.md` for request context, lifecycle, cardinality, and concurrency semantics.
