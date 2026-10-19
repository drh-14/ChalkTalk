# Design

## Context

See proposal.md for motivation and specs/live-code-sessions/spec.md for required behavior. This change builds on `add-live-code-sessions`:

- **Collaboration server.** It holds one Yjs document per session. `beforeSync` validates each update by applying it to a scratch copy and allowing only `Y.Text('content')`. `beforeHandleAwareness` stamps each awareness state's `user` with the authenticated identity and color. `persist()` writes the full state plus `text_projection` within 5 seconds, on last disconnect, and on end.
- **SessionView.** It owns a single Hocuspocus connection and Y.Doc. For an ended session it rebuilds a local doc from the snapshot text and shows it read-only.
- **Snapshot API.** It returns the text only.

Excalidraw 0.18.1 (MIT) findings, from its published types and bundle:

- **Scene updates.** It exposes `onChange(elements, appState, files)`, an imperative `updateScene({ elements, collaborators, captureUpdate })`, `CaptureUpdateAction`, `reconcileElements`, and `exportToBlob`.
- **Pointers.** It exposes `onPointerUpdate` and a `collaborators: Map<SocketId, Collaborator>` prop, and draws named pointers on its canvas.
- **Elements.** Each element has `id`, `version`, `versionNonce`, fractional `index`, and `isDeleted`; deletion is soft. Its types include `image`, `embeddable`, `iframe`, `frame`, and `magicframe`, which the allowlist will exclude.
- **Assets.** It loads fonts from `esm.sh` unless `window.EXCALIDRAW_ASSET_PATH` points elsewhere. The fonts directory is about 14 MB, and the main JavaScript is about 2.7 MB.
- **`y-excalidraw`.** Last published December 2024, it peers on Excalidraw `^0.17.6`. It is not used.

## Goals / Non-Goals

**Goals:**

- One session, one connection, one document: the whiteboard rides the existing ticket, presence, lifecycle, and persistence paths.
- Server-enforced safety for drawing content, matching the code document's validate-before-apply rule.
- No cost for users who never open the whiteboard.

**Non-Goals:**

- Images or files on the board, embeds, Excalidraw libraries, and multiple boards.
- Character-level merging inside one text element; concurrent edits to the same element resolve to one version.
- Server-side rendering of PNGs.

## Decisions

### D1. Whiteboard as a `Y.Map('whiteboard')` of plain element objects

The session document gains `doc.getMap('whiteboard')`, keyed by element ID, whose values are plain JSON element objects rather than nested Yjs types. Concurrent writes to different keys always merge. For the same key, Yjs picks one value deterministically.

*Alternative:* nested `Y.Map`s per element would merge field by field, but can produce combinations no participant drew (one person's points with another's bounds). Excalidraw's own collaboration treats elements as whole units, so this design does too.

### D2. Client binding: reconcile by version, then re-assert winners

`whiteboardBinding.ts` connects an Excalidraw API to the map:

- **Local changes.** On `onChange`, it writes each element whose `version` differs from the map's copy into the map in one transaction with a local origin. Pointer moves and selection fire `onChange` too, but they leave versions unchanged, so they write nothing.
- **Remote changes.** On a remote map change, it merges the map's changed elements with the local scene by Excalidraw's own rule (higher `version` wins, then the lower `versionNonce`). The rule is a few lines in the binding rather than an import of `reconcileElements`, so the binding stays free of the Excalidraw bundle and runs in unit tests. It applies the result with `updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })`, so remote changes never enter the local undo history and undo stays per user.
- **Convergence.** If, for some element, the local copy beats the map's copy under the same ordering (because Yjs chose a concurrent lower version), the binding writes the local copy back. The ordering is total, so all replicas converge on the highest version.
- **Order.** Elements are ordered by fractional `index`, then `id`.
- **Unsharable elements.** Excalidraw's toolbar still offers frames, web embeds, and pasted images, and a rejected update closes the connection. The binding therefore applies the server's element rules before writing: elements the server would reject stay on the local screen only, and links that are not `http(s)` are written as `null`.

*Alternative:* `y-excalidraw` was rejected for being unmaintained and incompatible with 0.18.

### D3. Server validation of whiteboard updates

`beforeSync` already applies each SyncStep2 or Update to a scratch copy. It now:

- allows only the shared types `content` (`Y.Text`) and `whiteboard` (`Y.Map`), and rejects any other key or any value that is a Yjs type;
- observes `whiteboard` on the scratch copy to find the changed keys, and validates only those elements, against the type allowlist, the `http(s)` link rule (parsed with `URL`), the absence of `fileId` and `customData`, a 64 KiB serialized size, 10,000 `freedraw` points, and 10,000 text characters;
- checks that the map has at most 5,000 entries and that `Y.encodeStateAsUpdate` is at most 5 MiB.

Failures close the connection with reason `invalid-update`, as for code, before the real document changes. The existing 256 KiB message limit stays; the 64 KiB per-element cap keeps any one update well below it.

### D4. Projection, persistence, and snapshot

Migration `021_collaboration_whiteboard.sql` adds `collaboration_documents.whiteboard_projection jsonb NOT NULL DEFAULT '[]'`. `persist()` writes the non-deleted elements in drawing order next to `text_projection`, in the same statement. The snapshot response gains `whiteboard`, from the projection. The ended-session view seeds a local doc's `whiteboard` map from it and renders Excalidraw with `viewModeEnabled`, keeping pan, zoom, and export.

### D5. Pointers through existing awareness

The client publishes `whiteboardPointer: { x, y, tool, button } | null` in awareness, set from `onPointerUpdate` and cleared when the tab is hidden or the component unmounts. The server's existing `beforeHandleAwareness` stamping supplies `user.name` and `user.color`. `pointerCollaborators(states, selfClientId)` maps other clients' states to named, colored pointers keyed by awareness client ID. This is a pure function, so it can be unit tested. Excalidraw colors its own remote pointers by a hash of the connection ID and ignores the colors it is given, so ChalkTalk does not pass them to Excalidraw. It draws them in a thin DOM overlay above the canvas instead, positioned from Excalidraw's scroll and zoom, so pointers match code cursors and can be read by tests.

### D6. Tabs in SessionView, lazy whiteboard

`SessionView` gains a Code/Whiteboard tab list using ARIA `tablist`. The editor and whiteboard share the session's Y.Doc and awareness. The whiteboard is `React.lazy(() => import("./Whiteboard.js"))`; that module imports `@excalidraw/excalidraw` and its CSS, so neither is in the main chunk. The Code tab stays mounted while hidden, so its undo history survives switching. The whiteboard mounts on first open and then stays mounted.

### D7. Self-hosted Excalidraw assets

A small Vite plugin in `vite.config.ts` serves `node_modules/@excalidraw/excalidraw/dist/prod/fonts` at `/excalidraw-assets/fonts/` in development and copies it into the build output. It uses no new dependency. `Whiteboard.tsx` sets `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"` before the dynamic import resolves. Fonts are fetched on demand, per font face.

### D7a. Board summary for screen readers

The canvas is invisible to assistive technology, so the whiteboard keeps a visually hidden, polite live summary such as "Whiteboard has 1 rectangle and 1 arrow". The browser test reads the same summary, since it cannot read the canvas.

### D8. PNG export on the client

The board's toolbar has **Export PNG**. It calls `exportToBlob({ elements, appState: { exportBackground: true, viewBackgroundColor: "#ffffff" }, files: null, mimeType: "image/png" })` and downloads `<slugified title>-whiteboard.png`. Excalidraw's own export and save menu items are hidden through `UIOptions`, so there's one export path and no file-system access prompts.

## Risks / Trade-offs

- [The bundle is large (~2.7 MB) and may slow the first whiteboard open] → It's lazily loaded and cached. A loading state shows "Loading whiteboard…".
- [Concurrent edits to the same element resolve to one version] → This matches Excalidraw's own collaboration and is rarely noticed. Validation keeps the merged state safe.
- [Server validation cost on large boards] → Only changed keys are validated, and the size check uses one encode of the scratch copy, bounded by the 5 MiB cap.
- [Excalidraw renders on canvas, which jsdom can't run] → Excalidraw is mocked in component tests. The binding and pointer mapping are pure and unit tested. The real rendering is covered by the Playwright test.
- [Excalidraw's internal APIs change between versions] → Pin `~0.18.1` and keep the binding in one module.
- [Archive order] → This change modifies `live-code-sessions`, which exists only once `add-live-code-sessions` is archived. Archive that change first.

## Migration Plan

Deploy migration 021, which only adds a column with a default, then the collaboration server, API and web build. Older clients ignore the `whiteboard` field and never write the map. Roll back by reverting the code; the column can stay.
