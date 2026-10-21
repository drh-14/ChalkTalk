# Tasks

## 1. Dependency and assets

- [x] 1.1 Add `@excalidraw/excalidraw@~0.18.1` to the web workspace with npm 11 (keeping lockfile `libc` fields); verify a single `yjs` copy, `npm run typecheck`, and `npm run build`, and that the main web chunk does not contain Excalidraw
- [x] 1.2 Add the Vite plugin that serves and copies Excalidraw fonts at `/excalidraw-assets/` (design D7); verify `development-config.test.ts` covers the plugin, `npm run build` emits the fonts, and a dev request for one font file returns `200`

## 2. Server validation and persistence

- [x] 2.1 Extend `beforeSync` validation to the `whiteboard` map (design D3): shared-type allowlist, element type allowlist, link rule, no `fileId` or `customData`, per-element size, point and text limits, element count, and document size; verify collaboration server tests accept each allowed type and reject each violation without changing or broadcasting the document, closing with `invalid-update`
- [x] 2.2 Add migration `021_collaboration_whiteboard.sql` with `whiteboard_projection`, write it from `persist()`, and return `whiteboard` from the snapshot service; update `documentation/database.md`; verify a schema test for the default, a server test that the projection holds only non-deleted elements in drawing order after store and restart, and an HTTP test for the snapshot field
- [x] 2.3 Verify, with a server test, that a client-supplied `user` on a whiteboard pointer awareness state is replaced by the authenticated identity

## 3. Contract documentation

- [x] 3.1 Update `collaboration-sessions.md` and `openapi.yaml` (the snapshot's `whiteboard` field and its element shape) and `collaboration-websocket.md` (the `whiteboard` shared map, validation rules, and the `whiteboardPointer` awareness field); verify the YAML parses, all references resolve, and the Markdown and OpenAPI operations still match

## 4. Browser binding and whiteboard

- [x] 4.1 Implement `whiteboardBinding.ts` (design D2) and `pointerCollaborators` (design D5); verify unit tests with two Y.Docs: concurrent edits to different elements both survive; concurrent edits to one element converge to the higher version on both sides, including the re-assert path; deletion propagates; order follows `index`; remote updates are applied without undo capture; and pointers map to named, colored collaborators excluding self
- [x] 4.2 Build the lazily loaded `Whiteboard.tsx` around Excalidraw, with self-hosted asset path, hidden built-in export and save menu items, view mode when ended, and **Export PNG** (design D8); verify component tests with Excalidraw mocked for view mode, the export file name, and pointer publishing and clearing
- [x] 4.3 Add the Code/Whiteboard tab list to `SessionView` sharing one connection, keeping the code editor mounted, and seeding the ended view's whiteboard from the snapshot; verify component tests that switching tabs does not reconnect or remount the editor, that the whiteboard chunk is requested only when its tab opens, and that an ended session shows a read-only whiteboard

## 6. Session view polish and naming

- [x] 6.1 Rename user-facing "live code session" text to "live session" in the web app, tests, and API reference prose; verify no user-visible string still says "live code session"
- [x] 6.2 Reorganize `SessionView`: shared full-height workspace, tab-bar actions (language and **Copy code** for Code, **Export PNG** for Whiteboard), **End session** in the header, participant initials in presence color with the viewer online while connected, and an **Invite** button that opens the picker; verify component tests for each and a browser screenshot of both tabs
- [x] 6.3 Hide Excalidraw's library browser and AI/diagram tools; verify the browser test sees neither control
- [x] 6.4 Escape-to-leave in the code editor with a visible hint; verify a component test that Escape then Tab moves focus without inserting a tab
- [x] 6.5 **Live session active** link in the post header and the language default from post tags; verify component tests for both

## 5. Integration checks

- [x] 5.1 Extend `tests/browser/live-code-session.spec.mjs` (or add a whiteboard spec): two participants draw different shapes at once and each sees both; the whiteboard becomes read-only after ending; no requests go to third-party hosts while using the whiteboard; verify it passes three runs in a row against the running stack
- [x] 5.2 Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL`, and `npm run build`; verify all pass, recording environment-only failures with evidence from `main`
  - Local run on Windows, 2026-10-19: all pass except 7 tests that fail identically on `add-live-code-sessions` without this change (`validate.test.ts` JPEG/WebP and PDF, `openapi.contract.test.ts` account creation, `jobs/process` and `digest/process` integration, and the two `App.test.tsx` password-reset tests). Job worker tests that timed out under full-suite load pass when run alone.
- [ ] 5.3 After `add-live-code-sessions` is archived, archive this change; verify `openspec validate` accepts the MODIFIED requirement against the archived `live-code-sessions` spec
