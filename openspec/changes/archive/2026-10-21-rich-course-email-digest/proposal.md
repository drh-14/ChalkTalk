# Why

The daily digest currently lists activity kinds and titles without the content readers need. Course emails should present linked titles, formatted previews, attached images, and rendered equations without changing eligibility or delivery semantics.

# What Changes

- Render spaced linked-title/body-preview entries in HTML and equivalent plain text, using each activity's own body.
- Parse Markdown/GFM/math and supported HTML with an explicit sanitizer; truncate previews by visible Unicode characters while keeping valid markup.
- Render equations locally into bounded CID PNG attachments, and embed bounded current authorized image attachment copies.
- Preserve UTC scheduling, membership/privacy exclusions, durable claims, retries, and existing activity kinds.

# Capabilities

## Modified Capabilities

- `daily-course-email-digest`: safe formatted content and bounded embedded media.

# Impact

API worker email projection, renderer and SMTP message type; API-local parser/MathJax dependencies; renderer/delivery/MIME tests and Mailpit screenshots. No database migration or frontend application changes.
