## Context

The statistics service already computes the UTC daily summary and current-student counts, while the browser fetches student pages of at most 100. Existing staff authorization and period validation belong to the service/HTTP seam.

## Goals / Non-Goals

**Goals:** Reuse existing calculations and access checks; provide predictable CSV output independent of browser pagination; prevent spreadsheet formula interpretation of profile text.

**Non-Goals:** Background jobs, arbitrary date ranges, alternate file formats, historical membership export, or new metrics.

## Decisions

- Use two GET endpoints below `/statistics/export/` (`daily` and `students`) and two explicit download actions. This is simpler than a combined ZIP and introduces no dependency.
- Produce the daily CSV from `summary()`. For roster CSV, use the same student aggregation query and UTC window as paginated statistics, but without a page limit. A single query avoids a browser-visible-only export and pagination gaps. The existing 5-second query timeout remains the operational bound.
- Encode RFC 4180-style CSV with CRLF records, quote escaping, and prefix an apostrophe to text whose trimmed leading character could start a spreadsheet formula (`=`, `+`, `-`, `@`). Fixed server-owned headers and numeric fields are not modified.
- Fetch CSV as a blob in the authenticated web client and download it via a temporary object URL. This allows HTTP failures to be shown in the page without navigation while keeping the current selected period stable.

## Risks / Trade-offs

- [Very large roster may exceed the existing query timeout or consume memory] → Return the existing `503 service_unavailable` rather than an incomplete file; no truncation or silent partial CSV.
- [Browser object URL remains allocated] → Revoke it after initiating the download.

## Migration Plan

No schema migration. Deploy API and UI together; rollback removes the endpoints and controls without data changes.
