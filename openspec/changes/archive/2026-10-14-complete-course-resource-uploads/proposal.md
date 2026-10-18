## Why

Course instructors need to share source files with members, but the documented upload API has no implementation. This slice makes uploads retrievable through the authenticated API while validating file structure before storage.

The first implementation still materialized entire uploads and inflated packages in memory. This follow-up completes the approved 100 MiB contract with file-backed validation and S3 transfer, and supports both local SeaweedFS and managed AWS.

## What Changes

- Add instructor-only course resource uploads and member-only original-byte downloads.
- Accept validated PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX and PPTX files up to 100 MiB.
- Persist ready resource metadata in PostgreSQL and exact bytes in S3-compatible object storage, with idempotent creation, best-effort upload failure cleanup, and resource-object removal in the existing course-deletion job.
- Add backend smoke tests for PNG, DOCX and PPTX round trips, authorization, idempotency and rejection.

## Capabilities

### New Capabilities

- `course-resource-uploads`: Validated course resource creation and authenticated byte retrieval.

### Modified Capabilities

None.

## Impact

API resource routes and service, PostgreSQL migration, S3 client configuration, OpenSpec contracts, Compose environment and backend integration tests. This slice does not include frontend, attachments, OCR, preview extraction, antivirus scanning or crash-orphan cleanup.
