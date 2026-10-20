import "./excalidrawAssetPath.js";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import {
  bindWhiteboard,
  pointerCollaborators,
  type BoardCollaborator,
  type BoardElement,
  type PointerState,
  describeBoard,
  whiteboardFileName,
} from "./whiteboardBinding.js";

type Binding = ReturnType<typeof bindWhiteboard<BoardElement>>;

const POINTER_INTERVAL_MS = 50;

const UI_OPTIONS = {
  canvasActions: {
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
  },
  tools: { image: false },
} as const;

export default function Whiteboard({
  board,
  awareness,
  readOnly,
  visible,
  title,
  actions,
  onPost,
}: {
  board: Y.Map<unknown>;
  awareness: Awareness | null;
  readOnly: boolean;
  visible: boolean;
  title: string;
  /** Where the tab bar holds this tab's actions. */
  actions?: HTMLElement | null;
  /** Offered as Post to discussion; receives the board as a PNG file. */
  onPost?: (file: File) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [exportError, setExportError] = useState<string>();
  const [summary, setSummary] = useState(() => describeBoard([]));
  const binding = useRef<Binding | null>(null);
  const lastPointer = useRef(0);
  const [pointers, setPointers] = useState<BoardCollaborator[]>([]);
  const [viewport, setViewport] = useState({ scrollX: 0, scrollY: 0, zoom: 1 });

  useEffect(
    () => () => {
      binding.current?.destroy();
      binding.current = null;
    },
    [board],
  );

  // Excalidraw hands out its API before it sets up its scene, and that setup
  // replaces the scene. Its first onChange comes after setup, so the board is
  // bound, and loaded into the scene, only then.
  function changed(elements: Parameters<Binding["onChange"]>[0]) {
    if (!api) return;
    binding.current ??= bindWhiteboard<BoardElement>(
      board,
      api as unknown as Parameters<typeof bindWhiteboard<BoardElement>>[1],
      CaptureUpdateAction.NEVER,
    );
    if (!readOnly) binding.current.onChange(elements);
  }

  // Excalidraw colors remote pointers by its own hash, so ChalkTalk draws them
  // in the colors the server assigns, matching the code cursors.
  useEffect(() => {
    if (!awareness) return;
    const show = () =>
      setPointers([
        ...pointerCollaborators(
          awareness.getStates(),
          awareness.clientID,
        ).values(),
      ]);
    show();
    awareness.on("change", show);
    return () => awareness.off("change", show);
  }, [awareness]);

  useEffect(() => {
    if (!api) return;
    const { scrollX, scrollY, zoom } = api.getAppState();
    setViewport({ scrollX, scrollY, zoom: zoom.value });
    return api.onScrollChange((scrollX, scrollY, zoom) =>
      setViewport({ scrollX, scrollY, zoom: zoom.value }),
    );
  }, [api]);

  // Leaving the tab or the page hides this participant's pointer for everyone.
  useEffect(() => {
    if (!awareness || (visible && !readOnly)) return;
    awareness.setLocalStateField("whiteboardPointer", null);
  }, [awareness, visible, readOnly]);
  useEffect(
    () => () => awareness?.setLocalStateField("whiteboardPointer", null),
    [awareness],
  );

  const exportBlob = (current: ExcalidrawImperativeAPI) =>
    exportToBlob({
      elements: current.getSceneElements(),
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
      files: null,
      mimeType: "image/png",
    });

  async function postBoard() {
    if (!api || !onPost) return;
    setExportError(undefined);
    try {
      const blob = await exportBlob(api);
      onPost(
        new File([blob], whiteboardFileName(title), { type: "image/png" }),
      );
    } catch {
      setExportError("The whiteboard couldn't be exported. Try again.");
    }
  }

  async function exportPng() {
    if (!api) return;
    setExportError(undefined);
    try {
      const blob = await exportBlob(api);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = whiteboardFileName(title);
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("The whiteboard couldn't be exported. Try again.");
    }
  }

  return (
    <div className="session-whiteboard">
      {actions &&
        createPortal(
          <>
            {exportError && (
              <span className="form-message error" role="alert">
                {exportError}
              </span>
            )}
            {onPost && (
              <button
                type="button"
                className="button secondary"
                disabled={!api}
                onClick={() => void postBoard()}
              >
                Post to discussion
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={!api}
              onClick={() => void exportPng()}
            >
              Export PNG
            </button>
          </>,
          actions,
        )}
      {/* The canvas is invisible to assistive technology; this says what it holds. */}
      <p
        className="visually-hidden session-whiteboard-summary"
        aria-live="polite"
      >
        {summary}
      </p>
      <div className="session-whiteboard-canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          isCollaborating
          viewModeEnabled={readOnly}
          UIOptions={UI_OPTIONS}
          name={title}
          onChange={(elements) => {
            setSummary(describeBoard(elements));
            changed(elements);
          }}
          onPointerUpdate={({ pointer, button }) => {
            if (!awareness || readOnly) return;
            const now = Date.now();
            if (now - lastPointer.current < POINTER_INTERVAL_MS) return;
            lastPointer.current = now;
            const state: PointerState = {
              x: pointer.x,
              y: pointer.y,
              tool: pointer.tool,
              button,
            };
            awareness.setLocalStateField("whiteboardPointer", state);
          }}
        >
          {/* Without the default social links, file actions, and collaboration items. */}
          <MainMenu>
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
        <div className="session-pointers" aria-hidden="true">
          {pointers.map((pointer) => (
            <span
              key={pointer.id}
              className={`session-pointer${pointer.button === "down" ? " pressed" : ""}`}
              data-name={pointer.username}
              style={{
                color: pointer.color.background,
                transform: `translate(${(pointer.pointer.x + viewport.scrollX) * viewport.zoom}px, ${(pointer.pointer.y + viewport.scrollY) * viewport.zoom}px)`,
              }}
            >
              <svg width="14" height="18" viewBox="0 0 14 18">
                <path
                  d="M1 1 L13 11 L7.5 11.5 L4.5 17 Z"
                  fill="currentColor"
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="session-pointer-label"
                style={{ background: pointer.color.background }}
              >
                {pointer.username}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
