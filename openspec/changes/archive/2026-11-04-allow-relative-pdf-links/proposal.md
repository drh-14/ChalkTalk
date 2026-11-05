## Why

The safe-link PDF validator still rejects ordinary relative hyperlinks, including the supplied syllabus's `./schedule.html` link. The user wants original PDFs with relative links accepted unchanged.

## What Changes

- Allow relative URI references as well as absolute HTTP/HTTPS links in structurally valid course-resource PDFs.
- Continue rejecting unsafe schemes, credential-bearing URLs, scripts, launches, embedded files, and other active actions.
- Preserve original uploaded bytes and the existing bounded qpdf inspection.

## Impact

PDF link validation, its tests, and course-file API/OpenSpec documentation. No new dependency or API shape change.
