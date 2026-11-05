## Why

Valid PowerPoint course resources with ordinary hyperlinks currently fail upload as unsupported files. The approved PDF-link policy should also cover PPTX hyperlinks.

## What Changes

- Permit HTTP, HTTPS, and relative hyperlink targets in PPTX relationship files.
- Keep non-hyperlink external relationships, executable content, unsafe schemes, and malformed links rejected.
- Preserve original PPTX bytes and existing DOCX behavior.

## Impact

Course-file validation, tests, and API documentation. No new dependency or response shape.
