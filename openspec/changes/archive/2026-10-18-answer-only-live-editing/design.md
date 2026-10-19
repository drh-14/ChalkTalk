## Context

The live-editing draft is not merged. Its migration currently creates followup Yjs rows, ticket type, and temporarily-empty followup bodies; all can be removed before deployment. The existing followup REST API already has version checks and conflict recovery.

## Decision

Retain the answer Yjs document and WebSocket path. Restrict the ticket route and document-name parser to `answer:<uuid>`; the store API accepts answer IDs only. Revert followup persistence/service hooks to the merged REST behavior. In the UI, answer edit opens the live editor with REST fallback, while followup and reply edit immediately opens `TextComposer`. Saved states render through the existing `PostBody` Markdown/KaTeX renderer.

## Verification

Test route rejection and direct store/transport denial, REST version checks, immediate rendered answer/followup/reply creation and edit, answer-only two-node convergence, and a real-browser mocked-API flow with screenshots. Keep existing answer full-stack live checks. The unused followup live browser tests are replaced rather than reported as passing.
