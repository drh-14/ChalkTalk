## Why

Ordinary course PDFs with web links or internal page navigation are rejected as active content. This blocks a valid course syllabus.

## What Changes

- Accept structurally valid PDFs containing absolute HTTP/HTTPS URI actions and internal GoTo actions, including a safe catalog OpenAction.
- Reject relative or unsafe URI schemes and retain rejection of scripts, launches, embedded files, remote navigation, and other active content.
- Parse qpdf structural JSON with a 128 MiB output bound and no new dependency.

## Impact

Course-file PDF validation, its tests, and the course-files specification. No API shape or storage change.
