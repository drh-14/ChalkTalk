# Discussion attachment verification

Verified on the merged save-only answer UI. All test data uses isolated schemas/buckets or mocked browser responses; no deployment embedding keys or real course data were used.

## Real-service checks

- Full suite: 606 tests passed, two SMTP-dependent digest tests skipped because this run does not configure Mailpit.
- 22 PostgreSQL/SeaweedFS HTTP scenarios cover PNG/DOCX/PPTX bytes, validation/auth/CSRF, role floors, anonymous contributor privacy, idempotency, five-file races, parent deletion/duplicate/unmerge/archive, endorsement history and Markdown-save conflicts.
- The process smoke logs into the actual API, uploads/downloads/replays PNG/DOCX/PPTX, rejects a script disguised as PNG, verifies a removed image becomes unreadable immediately while its object still exists, then starts the separate worker and verifies byte cleanup. Teardown removes its bucket and schema.
- Deterministic sibling answer/followup uploads failed before the parent-lock fix and pass after it. Delayed post-refresh retries likewise have red/green coverage.
- Typecheck, ESLint, Prettier, production builds and strict OpenSpec validation pass. The existing Vite bundle-size advisory remains unchanged.

## Browser checks

Ten real Chromium scenarios use mocked API responses (not full-stack browser sessions). The real API/worker/S3 checks above separately verify backend behavior. The existing three save-only answer browser regressions also pass.

| Scenario                                                                           | Evidence                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Centered question image and attached answer/followup documents                     | [Question](question-answer-followup.png), [Answer](answer-document.png), [Followup](followup-document.png), [Reply](reply-document.png) |
| Note image                                                                         | [Note](note-image.png)                                                                                                                  |
| Text survives composer upload failure and retry                                    | [Retry](upload-retry-needed.png), [Recovered](upload-recovered.png)                                                                     |
| New answer, followup and reply upload after text creation                          | [Answer](created-answer-image.png), [Followup](created-followup-document.png), [Reply](created-reply-document.png)                      |
| Explicit answer overwrite preserves current files and renders saved Markdown/LaTeX | [Conflict](answer-conflict-attachments.png), [Saved](answer-saved-attachments.png)                                                      |
| Authorized removal and archived mobile read-only viewing                           | [Removed](removed-answer-document.png), [Mobile](archived-mobile-image.png)                                                             |
| Existing post partial-upload failure retains file/key through delayed refresh      | [Retry](existing-post-partial-retry.png), [Recovered](existing-post-recovered.png)                                                      |
| Five-file selection limit                                                          | [Limit](five-file-limit.png)                                                                                                            |

Browser command: `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/chalktalk-playwright npm run test:browser:attachments` on this machine. CI installs its own Chromium and runs the same npm script.
