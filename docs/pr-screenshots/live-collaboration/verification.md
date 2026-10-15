# Live editor browser verification

On 2026-10-14, Playwright exercised the answer editor in Chromium with the ticket HTTP response mocked and a local Hocuspocus/Yjs test server. The latter was reset between scenarios; no production API or database was used.

- **Connected** (`connected.png`): loaded saved Markdown/LaTeX text, typed a live change, observed synchronized status, and reloaded to confirm the change remained.
- **Disconnected draft** (`disconnected-draft.png`): stopped the server, typed locally, and observed the disconnected warning and retry control while retaining the draft.
- **Recovered draft** (`recovered-draft.png`): restarted the same mock server with its saved state, retried with a fresh ticket, and reloaded to confirm the offline draft was synchronized.

Playwright also exercised the **live followup body editor** in Chromium with the followup ticket HTTP response mocked and a local Hocuspocus/Yjs server. The server held document state in memory; no production API or database was used.

- **Connected followup** (`followup-connected.png`): loaded saved Markdown/LaTeX text, typed a live followup change, observed synchronized status, and reloaded to confirm the change remained.
- **Disconnected followup draft** (`followup-disconnected-draft.png`): stopped the local server, typed into the followup editor, and observed the disconnected warning and retry control while retaining the local draft.

The full-app answer/followup panels are covered by the existing mocked-browser verification in `documentation/browser-screenshots/answers-followups-ui/`; these runs exercise the new collaborative editor path in isolation.

On 2026-10-15, a two-editor Chromium fixture rendered the actual `LiveBodyEditor` in separate tabs against mocked ticket HTTP and a local in-memory Hocuspocus/Yjs server. An anonymous contributor entered Markdown with LaTeX in one editor; the peer visibly received the edit. The fixture issued a private identity-bearing one-use ticket on each connection. Browser assertions confirmed the peer DOM did not contain that identity, the server received no awareness states, and reloading the peer consumed a third fresh ticket while retaining the shared edit. [Anonymous awareness screenshot](anonymous-awareness.png) shows the rendered editor after the concurrent change. This was mocked-browser coverage, not a full-stack authenticated browser run; the existing real PostgreSQL/two-node Redis tests cover the server path separately.
