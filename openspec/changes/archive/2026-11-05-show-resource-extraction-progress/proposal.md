# Proposal

## Why

Resources show a static “Contents not searchable yet” notice during extraction, and an expanded extracted-text panel fetches only once. Readers cannot tell whether OCR is advancing and must manually refresh to see finished text.

## What Changes

- Replace the existing staff pending notice with queued/preparing/OCR/saving feedback and real completed/total OCR-page progress when known, without estimating completion time.
- Persist attempt-fenced per-file progress with a small additive migration; retain the current pending/ready/failed/unsupported text statuses.
- Expose lightweight progress on existing authorized resource metadata responses and automatically refresh pending status in place, preserving loaded catalog/search pages and unsaved edits.
- Automatically load finished text into an open pending text panel; retain manual recovery for errors or a prolonged wait.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-text-search`: durable truthful extraction progress and automatic status/text refresh under existing catalog visibility rules.

## Impact

Additive migration on course_file_texts; extraction callbacks/store and lease-aware worker updates; existing resource list/search/read metadata projection; resource client/components and scoped styles; API/OpenAPI/database references; API/lifecycle tests and mocked-API Chromium scenarios with screenshots. No service, dependency, streaming protocol, ETA, partial-text publication, or changes to searchable-PDF generation. Build on PR #147 in a separate branch/PR; target its branch until it merges.
