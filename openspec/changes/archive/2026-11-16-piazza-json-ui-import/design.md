## Context

The CLI already converts `PiazzaExport` and writes content in one transaction with an advisory lock. Its `--from` path trusts a TypeScript cast; public upload requires runtime validation. The existing multipart reader writes a temporary file and defaults to a 100 MiB media limit. See the approved [dated design](../../../docs/design/2026-11-16-piazza-json-ui-import.md) for the boundary and alternatives.

## Goals / Non-Goals

**Goals:** Reuse the importer, enforce atomic UI re-import authorization, omit private content, give the user a clear preview and result, and clean up uploads.

**Non-Goals:** Piazza sign-in, native export formats, background jobs, durable source storage, or changes to CLI import semantics.

## Decisions

On UI upload, treat `selfUid` as an unverified historical Piazza identity rather than the authenticated ChalkTalk uploader. Keep the uploader as course owner and represent retained exporter-authored content with the same synthetic account used for other historical authors, including on re-import. Preserve the CLI importer's `selfUid`-to-owner mapping.

- Use `POST /api/v1/piazza-imports` with one multipart `file`, session/CSRF/origin protection, a 20 MiB endpoint-specific cap, strict bounded validation, and aggregate response. This avoids the JSON-body limit and does not retain the source.
- Keep preview local to the browser; the server validates and counts independently. Require explicit acknowledgement before upload.
- Filter private posts and private-only people before conversion, then invoke the existing importer. Keep the CLI path unfiltered.
- Pass the authenticated actor as an internal UI-only option to the importer. After the advisory lock, atomically inspect and lock the existing course and instructor membership before any auto-enrollment. Preserve the CLI's operator path.
- Return an actionable error for a file larger than the web cap rather than introducing a queue or staging service at current scale.

## Risks / Trade-offs

- Large files or long transactions can exceed request budgets → bound file and nested counts; direct unusually large authorized imports to the CLI.
- Client preview could diverge from server validation → treat server response as authoritative and never trust client counts.
- Existing courses previously imported by CLI may contain private posts → UI re-import does not delete old rows; any cleanup requires separate review.
- Revocation race could auto-promote a former instructor → check membership inside the import transaction and lock the relevant rows before writing.

## Migration Plan

No schema migration. Deploy the API and UI together; the old CLI remains available. Roll back by removing the UI/API route; existing imported courses remain.
