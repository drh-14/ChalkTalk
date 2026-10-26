# Design

Use the separate worker's existing digest delivery transaction and selected eligible activity. Add entity identity and body projection to that query; do not change eligibility, midnight scheduling, outbox state or delivery locking. Load only active image attachments for included parents with current course-member and public-parent checks.

Parse at most 128 KiB of source through unified, remark-parse/GFM/math, remark-rehype, rehype-raw/sanitize/stringify. Bound AST nodes. Allow safe formatting and absolute HTTP(S) links without credentials. Remove user images, executable tags, events, styles, SVG, forms and embeds. Generate trusted CID image markup only after sanitization. Produce plain text from the same safe tree. A preview contains at most 600 visible Unicode codepoints; keep formulas atomic and link to the full post.

Render bounded base/AMS TeX locally with MathJax SVG output and existing Sharp to PNG in a terminable worker thread: 2 KiB TeX, 5 KiB macro buffer, 2 seconds/formula, 20 equations/email, 200 KiB/equation and 1 MiB total. Unrenderable/over-limit math becomes a linked placeholder, not visible raw source in HTML; escaped alternative/plain text retains TeX.

Embed at most five source image attachments, each at most 5 MiB and 12 megapixels. Sequentially decode/re-encode with Sharp to at most 1200 pixels wide, 1 MiB/output and 5 MiB total user images, with 3-second source-read/processing bounds. Total inline binary budget is 6 MiB. Oversized/corrupt/unavailable images use authenticated links; denied/deleted images disclose no metadata. Never fetch Markdown external images. Existing worker S3 config supplies a bounded reader. SMTP accepts optional HTML and typed inline image attachments; other emails stay unchanged.

Render at most fifty entries while retaining complete activity counts, with a remaining-activity link when truncated. HTML SHALL remain at most 256 KiB. No external rendering service, CDN, browser runtime or public storage URLs.
