## 1. Post editing
- [x] 1.1 Add specification-derived Discussion/client tests and confirm RED for authorized Edit and read-only view.
- [x] 1.2 Implement versioned post editing, local drafts, cancel/error/conflict recovery; confirm focused tests GREEN.
- [x] 1.3 Put post attachment mutations inside editor, retaining queue/revisions/local drafts across partial failures; verify attachment regressions.
- [x] 1.4 Verify that attachment refresh can learn remote text while retaining the local draft; only an explicit Save sends the refreshed If-Match PATCH, while an actual 412 still requires review.
- [x] 1.5 Keep the post editor and failed-file queue on merge failure, and block edits while merge is pending.
- [x] 1.6 Move existing answer and followup attachment mutation controls into authorized Edit for both slots, roots and replies, retaining create and partial-failure flows.
- [x] 1.7 Apply narrow shared Edit-button radius/padding styling without changing colors.
## 2. Verification and delivery
- [x] 2.1 Exercise mocked Chromium desktop/mobile view, edit/save, create, retry, cancel and permission/archive cases and capture screenshots.
- [x] 2.2 Run tests, lint, format, typecheck and build; sync/archive validated OpenSpec.
- [x] 2.3 Prepare the scoped one-commit no-mistakes submission with browser screenshots; the publication gate records draft PR and final-head CI evidence.
