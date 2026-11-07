## Context

The resource-text worker calls `loadResourceTextConfig` from `environment.ts`; the current loader parses two environment variables and defaults to 200 pages and `eng`. Both deployment images install English Tesseract data. The existing extraction worker already accepts `{ maxOcrPages, ocrLanguages }`.

## Goals / Non-Goals

**Goals:** Keep runtime OCR behavior at its current defaults while removing per-deployment OCR configuration and its error paths.

**Non-Goals:** Change OCR algorithms, add language packs, alter extraction persistence, or migrate data.

## Decisions

- Define a frozen OCR configuration in `config/constants.ts` and pass it to the existing worker seam. Remove the old environment parser rather than leaving ignored arguments or duplicate defaults. This keeps one source of truth without adding an abstraction.
- Keep the English packages in both images and remove the OCR entries from both deployment templates and README instructions.

## Risks / Trade-offs

- [Future deployments need different OCR languages or cap] → Change the constant and install the corresponding Tesseract package in an explicit reviewed code change.
- [Operators still have obsolete values in an old `.env`] → They no longer affect OCR; release documentation identifies these names as obsolete.

## Migration Plan

No database migration. On deployment, remove the two old variables from local/production `.env` files. Rollback restores the previous code and environment-based configuration.
