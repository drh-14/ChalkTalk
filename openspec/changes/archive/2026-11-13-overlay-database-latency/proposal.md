## Why

Operators need to compare API response times with database query and pool wait times on the same time axis and scale.

## What Changes

Overlay database query duration and pool wait on the existing p50 and p95 HTTP latency panels. Keep the database volume and failure panels. Add endpoint-specific p50/p95 charts for login, course creation, and notification fetching (list and unread count), with request-attributed totals of all database query and pool-acquisition work for each operation.

## Capabilities

### Modified Capabilities

- `api-observability`: Show HTTP and database latency together by percentile.
