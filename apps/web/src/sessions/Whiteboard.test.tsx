import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const excalidraw = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  scene: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  scroll: undefined as
    | ((scrollX: number, scrollY: number, zoom: { value: number }) => void)
    | undefined,
  exportToBlob: vi.fn<(options: unknown) => Promise<Blob>>(
    async () => new Blob(["png"]),
  ),
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", async () => {
  const { useEffect } = await import("react");
  const api = {
    getSceneElementsIncludingDeleted: () => excalidraw.scene,
    getSceneElements: () => excalidraw.scene,
    getAppState: () => ({ scrollX: 10, scrollY: 20, zoom: { value: 2 } }),
    onScrollChange: (callback: NonNullable<typeof excalidraw.scroll>) => {
      excalidraw.scroll = callback;
      return () => undefined;
    },
    updateScene: (scene: Record<string, unknown>) => {
      excalidraw.updates.push(scene);
      if (scene.elements) excalidraw.scene = scene.elements as unknown[];
    },
  };
  return {
    CaptureUpdateAction: { NEVER: "NEVER" },
    MainMenu: Object.assign(
      ({ children }: { children?: unknown }) => <>{children}</>,
      {
        DefaultItems: {
          SearchMenu: () => null,
          Help: () => null,
          ToggleTheme: () => null,
          ChangeCanvasBackground: () => null,
        },
      },
    ),
    exportToBlob: excalidraw.exportToBlob,
    Excalidraw: (props: Record<string, unknown>) => {
      excalidraw.props = props;
      const ready = props.excalidrawAPI as (value: typeof api) => void;
      useEffect(() => ready(api), [ready]);
      return <div data-testid="excalidraw" />;
    },
  };
});

const { whiteboardFileName } = await import("./whiteboardBinding.js");
const { default: Whiteboard } = await import("./Whiteboard.js");

// The tab bar slot where the whiteboard puts Export PNG.
let actions: HTMLDivElement;

function setup(props: { readOnly?: boolean; visible?: boolean } = {}) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const element = (
    <Whiteboard
      board={doc.getMap("whiteboard")}
      awareness={awareness}
      readOnly={props.readOnly ?? false}
      visible={props.visible ?? true}
      title="Why does my loop never stop?"
      actions={actions}
    />
  );
  const view = render(element);
  return { doc, awareness, view };
}
const pointer = (x: number) =>
  (excalidraw.props!.onPointerUpdate as (payload: unknown) => void)({
    pointer: { x, y: 2, tool: "pointer" },
    button: "up",
    pointersMap: {},
  });

beforeEach(() => {
  actions = document.createElement("div");
  document.body.append(actions);
  excalidraw.props = undefined;
  excalidraw.scene = [];
  excalidraw.updates = [];
  excalidraw.scroll = undefined;
  excalidraw.exportToBlob.mockClear();
});
afterEach(() => {
  cleanup();
  actions.remove();
  vi.restoreAllMocks();
});

it("loads fonts from ChalkTalk and hides Excalidraw's own export and image tool", () => {
  setup();
  expect(window.EXCALIDRAW_ASSET_PATH).toBe("/excalidraw-assets/");
  expect(excalidraw.props).toMatchObject({
    viewModeEnabled: false,
    isCollaborating: true,
    UIOptions: {
      canvasActions: {
        export: false,
        saveAsImage: false,
        saveToActiveFile: false,
        loadScene: false,
        clearCanvas: false,
      },
      tools: { image: false },
    },
  });
});

it("shows a read-only board in view mode and does not write to it", async () => {
  const { doc } = setup({ readOnly: true });
  expect(excalidraw.props!.viewModeEnabled).toBe(true);
  await waitFor(() => expect(excalidraw.props).toBeDefined());
  (excalidraw.props!.onChange as (elements: unknown[]) => void)([
    { id: "r1", type: "rectangle", version: 1, versionNonce: 1 },
  ]);
  pointer(1);
  expect(doc.getMap("whiteboard").size).toBe(0);
  expect(
    (screen.getByRole("button", { name: "Export PNG" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("loads an existing board only after Excalidraw has set up its scene", async () => {
  const doc = new Y.Doc();
  doc.getMap("whiteboard").set("r1", {
    id: "r1",
    type: "rectangle",
    version: 2,
    versionNonce: 1,
    index: "a0",
  });
  render(
    <Whiteboard
      board={doc.getMap("whiteboard")}
      awareness={null}
      readOnly
      visible
      title="Ended"
    />,
  );
  await waitFor(() => expect(excalidraw.props).toBeDefined());
  expect(excalidraw.updates).toEqual([]);
  // Excalidraw reports its first change once its own scene setup is done.
  act(() => (excalidraw.props!.onChange as (elements: unknown[]) => void)([]));
  expect(excalidraw.scene).toMatchObject([{ id: "r1" }]);
});

it("shares drawn elements through the board", async () => {
  const { doc } = setup();
  await waitFor(() => expect(excalidraw.props).toBeDefined());
  (excalidraw.props!.onChange as (elements: unknown[]) => void)([
    { id: "r1", type: "rectangle", version: 1, versionNonce: 1, index: "a0" },
  ]);
  expect(doc.getMap("whiteboard").get("r1")).toMatchObject({
    type: "rectangle",
  });
});

it("publishes the pointer and clears it when the tab is hidden or closed", async () => {
  const { awareness, view, doc } = setup();
  pointer(10);
  expect(awareness.getLocalState()?.whiteboardPointer).toEqual({
    x: 10,
    y: 2,
    tool: "pointer",
    button: "up",
  });
  view.rerender(
    <Whiteboard
      board={doc.getMap("whiteboard")}
      awareness={awareness}
      readOnly={false}
      visible={false}
      title="Why does my loop never stop?"
      actions={actions}
    />,
  );
  expect(awareness.getLocalState()?.whiteboardPointer).toBeNull();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
  pointer(20);
  expect(awareness.getLocalState()?.whiteboardPointer).toMatchObject({ x: 20 });
  view.unmount();
  expect(awareness.getLocalState()?.whiteboardPointer).toBeNull();
});

it("draws other participants' pointers with their server names and colors", async () => {
  const { awareness, doc } = setup();
  await waitFor(() => expect(excalidraw.scroll).toBeDefined());
  const other = new Awareness(new Y.Doc());
  other.setLocalState({
    user: { name: "Tim TA", color: "#c2410c" },
    whiteboardPointer: { x: 1, y: 1, tool: "pointer", button: "down" },
  });
  act(() => {
    awareness.states.set(other.clientID, other.getLocalState()!);
    awareness.emit("change", [
      { added: [other.clientID], updated: [], removed: [] },
      "remote",
    ]);
  });
  const pointer = document.querySelector(".session-pointer") as HTMLElement;
  expect(pointer.dataset.name).toBe("Tim TA");
  expect(pointer.textContent).toBe("Tim TA");
  expect(pointer.style.color).toBe("rgb(194, 65, 12)");
  // Scene (1, 1) scrolled by (10, 20) at 2x zoom.
  expect(pointer.style.transform).toBe("translate(22px, 42px)");
  act(() => excalidraw.scroll!(0, 0, { value: 1 }));
  expect(pointer.style.transform).toBe("translate(1px, 1px)");
  // Excalidraw's own pointers, which ignore these colors, are not used.
  expect(excalidraw.updates.some((update) => update.collaborators)).toBe(false);
  doc.destroy();
});

it("exports a PNG named after the session on a white background", async () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  let downloaded = "";
  click.mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = this.download;
  });
  URL.createObjectURL = vi.fn(() => "blob:png");
  URL.revokeObjectURL = vi.fn();
  setup();
  excalidraw.scene = [{ id: "r1", type: "rectangle" }];
  await userEvent.click(screen.getByRole("button", { name: "Export PNG" }));
  await waitFor(() =>
    expect(downloaded).toBe("why-does-my-loop-never-stop-whiteboard.png"),
  );
  expect(excalidraw.exportToBlob).toHaveBeenCalledWith({
    elements: [{ id: "r1", type: "rectangle" }],
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: null,
    mimeType: "image/png",
  });
});

it("derives safe file names", () => {
  expect(whiteboardFileName("Café: week 3 / loops!")).toBe(
    "cafe-week-3-loops-whiteboard.png",
  );
  expect(whiteboardFileName("???")).toBe("session-whiteboard.png");
});
