## Context

The resource API and database are documented but not implemented. SeaweedFS already runs with a local S3 endpoint in Compose. Existing Express routes use session, Origin and CSRF guards, PostgreSQL transactions, and shared idempotency records.

## Goals / Non-Goals

- Goals: instructor upload, original-byte member download, bounded validation, transactional metadata, idempotent replay, real PostgreSQL and SeaweedFS smoke tests.
- Non-goals: links, listing/update/delete, previews/OCR, attachments, antivirus guarantee, background orphan scavenger, frontend.

## Decisions

### Multipart and size

Parse exactly one `metadata` JSON part and one file part. Reject excess parts and bodies early. Stage at most 100 MiB of bytes in a temporary file, hash while streaming, and delete the staged file in `finally`. Validate before S3 PUT. Do not buffer a full 100 MiB in the API heap.

The staged file remains owned by the HTTP request until creation settles. The service hashes it in chunks, validates it from disk, and streams it to S3 with a known content length. Retries read the staged file again without duplicating its full contents in memory.

### Validation

Map exact extension and MIME pairs to the eight allowlisted formats. Parse PDF boundaries/trailer, UTF-8 text, PNG/JPEG/WebP structure and OOXML ZIP central directory with bounded entry counts, uncompressed sizes and total expansion. Reject macros, executable/package payloads, duplicate/unsafe paths, external relationships and active content. This is structural validation, not malware scanning.

All format validation must use bounded process memory at the 100 MiB limit. The API container and CI install qpdf as a runtime PDF parser. PDF validation checks its syntax, page count, and parsed object names through streamed qpdf JSON without including stream data. The parsed representation exposes names inside compressed object streams and canonicalizes escaped names. The API rejects actions, embedded files, rich media, XFA, external links, and encryption. qpdf output is scanned incrementally with bounded token size and a process timeout.

### Object storage configuration

Use generic S3 configuration: bucket and region select the managed bucket; an optional endpoint enables local SeaweedFS with path-style requests and local credentials. Without an endpoint, use the AWS SDK default credential chain and do not create or probe buckets at API startup. When a local endpoint is set, the API may create the development bucket at startup.

### Persistence and idempotency

Use the existing `resources` shape and `idempotency_records`. Serialize same-key requests with a PostgreSQL advisory lock; check the stored hash under the lock. A still-authorized instructor receives an exact matching replay even after course archival. For a new key, validate/PUT, then lock and recheck active course status before inserting ready metadata and the idempotency response in one transaction. On ordinary transaction failure after PUT, attempt best-effort object deletion; an S3 deletion failure may leave an orphan and has no durable retry in this slice. If COMMIT acknowledgment is lost, retain an object that may have committed; delete only after rollback and a database check prove it did not. Store object keys as random UUID-based values. The crash window between PUT and commit is deferred for future orphan cleanup.

### Course deletion

The existing deletion worker locks the course before selecting resource object keys so concurrent uploads cannot commit after the key snapshot. It requires successful idempotent object deletion before committing the database transaction; a storage failure rolls back metadata deletion and invokes the job's existing retry policy. A later database failure can leave metadata pointing at already removed bytes until retry, but the course is already in deleting status and uploads are blocked.

### Download

Check current membership and ready resource in PostgreSQL on every request. Stream S3 bytes through Express with `Content-Type`, `Content-Length`, `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`. Do not expose S3 credentials or URL.

## Risks / Tradeoffs

Staging adds disk I/O but bounds heap use. Structural checks cannot prove a valid file is malware-free. A process crash after S3 PUT can leave an orphan object, which needs later scavenging. Lack of a frontend keeps this API-only.
