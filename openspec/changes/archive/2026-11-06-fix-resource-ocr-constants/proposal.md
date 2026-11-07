## Why

OCR tuning is currently exposed in environment files even though this deployment ships only English Tesseract data and uses a single page cap. Removing these variables makes local and production setup less error-prone.

## What Changes

- **BREAKING for operators:** OCR page cap and language can no longer be overridden through `RESOURCE_OCR_MAX_PAGES` or `RESOURCE_OCR_LANGUAGES`.
- Use a fixed 200-page cap and English (`eng`) language from application constants.
- Remove obsolete OCR environment entries and instructions from local and production deployment documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-text-search`: Fix the OCR page cap and language rather than treating them as deployment settings.

## Impact

The resource-text worker configuration and deployment environment templates/documentation change. Existing extraction results, database schema, HTTP APIs, and container toolchain do not change.
