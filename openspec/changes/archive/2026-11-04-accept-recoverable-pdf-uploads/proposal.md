# Why

Readable course PDFs are rejected when qpdf reconstructs a damaged cross-reference table and exits successfully with warnings (3). The reported 18-page course reading reproduces this.

# What Changes

Accept qpdf warning-only completion while retaining boundary checks, positive page count, parsed-name scanning, bounded output and process timeout. Reject fatal parsing errors and restricted content even when recovery succeeds. Store and download the original bytes unchanged.

# Capabilities

## Modified Capabilities

- `course-files`: accept recoverable PDF structure warnings.

# Impact

Shared PDF validation affects course files and post/thread attachments. No frontend or schema changes. URL policy is outside this fix.
