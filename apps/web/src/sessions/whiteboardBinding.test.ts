import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  bindWhiteboard,
  pointerCollaborators,
  describeBoard,
  storable,
  type BoardElement,
} from "./whiteboardBinding.js";

type Element = BoardElement & { type: string; x: number };

const NEVER = "NEVER";

const element = (id: string, overrides: Partial<Element> = {}): Element => ({
  id,
  type: "rectangle",
  x: 0,
  version: 1,
  versionNonce: 10,
  index: "a0",
  isDeleted: false,
  ...overrides,
});

/** A stand-in for the Excalidraw API that records how it was updated. */
function fakeScene() {
  let elements: readonly Element[] = [];
  const captures: unknown[] = [];
  return {
    captures,
    get elements() {
      return elements;
    },
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: vi.fn(
      (scene: { elements: readonly Element[]; captureUpdate: unknown }) => {
        elements = scene.elements;
        captures.push(scene.captureUpdate);
      },
    ),
    /** What a local edit in Excalidraw does: change the scene, then onChange. */
    draw(next: readonly Element[], onChange: (e: readonly Element[]) => void) {
      elements = next;
      onChange(next);
    },
  };
}

function participant() {
  const doc = new Y.Doc();
  const scene = fakeScene();
  const binding = bindWhiteboard<Element>(
    doc.getMap("whiteboard"),
    scene,
    NEVER,
  );
  return { doc, scene, binding };
}

/** Two participants whose documents can be connected and disconnected. */
function pair() {
  const a = participant();
  const b = participant();
  let online = true;
  const queued: [Y.Doc, Uint8Array][] = [];
  const relay = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    if (online) Y.applyUpdate(to, update, "remote");
    else queued.push([to, update]);
  };
  a.doc.on("update", relay(b.doc));
  b.doc.on("update", relay(a.doc));
  return {
    a,
    b,
    offline() {
      online = false;
    },
    online() {
      online = true;
      for (const [to, update] of queued.splice(0))
        Y.applyUpdate(to, update, "remote");
    },
  };
}

const ids = (scene: { elements: readonly Element[] }) =>
  scene.elements.filter((e) => !e.isDeleted).map((e) => e.id);

describe("whiteboard binding", () => {
  it("keeps concurrent edits to different elements on both sides", () => {
    const { a, b, offline, online } = pair();
    offline();
    a.scene.draw([element("rect")], a.binding.onChange);
    b.scene.draw(
      [element("arrow", { type: "arrow", index: "a1" })],
      b.binding.onChange,
    );
    online();
    expect(ids(a.scene)).toEqual(["rect", "arrow"]);
    expect(ids(b.scene)).toEqual(["rect", "arrow"]);
  });

  it("converges concurrent edits to one element on the higher version", () => {
    const { a, b, offline, online } = pair();
    a.scene.draw([element("box")], a.binding.onChange);
    offline();
    a.scene.draw([element("box", { version: 3, x: 30 })], a.binding.onChange);
    b.scene.draw([element("box", { version: 2, x: 20 })], b.binding.onChange);
    online();
    expect(a.scene.elements[0]).toMatchObject({ version: 3, x: 30 });
    expect(b.scene.elements[0]).toMatchObject({ version: 3, x: 30 });
    expect(a.doc.getMap("whiteboard").get("box")).toMatchObject({ x: 30 });
    expect(b.doc.getMap("whiteboard").get("box")).toMatchObject({ x: 30 });
  });

  it("re-asserts the local winner when Yjs keeps the lower version", () => {
    const { a, b, offline, online } = pair();
    a.scene.draw([element("box")], a.binding.onChange);
    offline();
    a.scene.draw([element("box", { version: 5, x: 50 })], a.binding.onChange);
    b.scene.draw([element("box", { version: 2, x: 20 })], b.binding.onChange);
    // Force the map to hold B's lower copy on both sides, as a Yjs tie-break can.
    online();
    b.doc
      .getMap("whiteboard")
      .set("box", element("box", { version: 2, x: 20 }));
    expect(a.scene.elements[0]).toMatchObject({ version: 5, x: 50 });
    expect(b.scene.elements[0]).toMatchObject({ version: 5, x: 50 });
    expect(b.doc.getMap("whiteboard").get("box")).toMatchObject({ version: 5 });
  });

  it("breaks version ties with the lower nonce", () => {
    const { a, b, offline, online } = pair();
    offline();
    a.scene.draw(
      [element("box", { versionNonce: 9, x: 1 })],
      a.binding.onChange,
    );
    b.scene.draw(
      [element("box", { versionNonce: 4, x: 2 })],
      b.binding.onChange,
    );
    online();
    expect(a.scene.elements[0]).toMatchObject({ x: 2 });
    expect(b.scene.elements[0]).toMatchObject({ x: 2 });
  });

  it("propagates soft and hard deletions", () => {
    const { a, b } = pair();
    a.scene.draw(
      [element("one"), element("two", { index: "a1" })],
      a.binding.onChange,
    );
    expect(ids(b.scene)).toEqual(["one", "two"]);
    a.scene.draw(
      [
        element("one", { version: 2, isDeleted: true }),
        element("two", { index: "a1" }),
      ],
      a.binding.onChange,
    );
    expect(ids(b.scene)).toEqual(["two"]);
    a.doc.getMap("whiteboard").delete("two");
    expect(b.scene.elements.map((e) => e.id)).toEqual(["one"]);
  });

  it("orders elements by fractional index, then id", () => {
    const { a, b } = pair();
    a.scene.draw(
      [
        element("z", { index: "a0" }),
        element("m", { index: "a2" }),
        element("b", { index: "a2" }),
        element("q", { index: "Zz" }),
      ],
      a.binding.onChange,
    );
    expect(ids(b.scene)).toEqual(["q", "z", "b", "m"]);
  });

  it("applies remote changes without undo capture and writes nothing for unchanged versions", () => {
    const { a, b } = pair();
    a.scene.draw([element("box")], a.binding.onChange);
    expect(b.scene.captures).toEqual([NEVER]);
    const updates = vi.fn();
    b.doc.on("update", updates);
    // Excalidraw calls onChange after updateScene and on selection or pointer moves.
    b.binding.onChange(b.scene.elements);
    expect(updates).not.toHaveBeenCalled();
  });

  it("loads an existing board when it binds and stops after destroy", () => {
    const doc = new Y.Doc();
    doc.getMap("whiteboard").set("old", element("old"));
    const scene = fakeScene();
    const binding = bindWhiteboard<Element>(
      doc.getMap("whiteboard"),
      scene,
      NEVER,
    );
    expect(ids(scene)).toEqual(["old"]);
    binding.destroy();
    doc.getMap("whiteboard").set("new", element("new"));
    expect(ids(scene)).toEqual(["old"]);
  });
});

describe("storable", () => {
  it("keeps elements the server rejects off the shared board", () => {
    const { a, b } = pair();
    a.scene.draw(
      [
        element("frame", { type: "frame" }),
        element("embed", { type: "embeddable" }),
        { ...element("pic", { type: "image" }), fileId: "f1" } as Element,
        { ...element("data"), customData: { x: 1 } } as Element,
        {
          ...element("long", { type: "text" }),
          text: "t".repeat(10_001),
        } as Element,
        element("ok", { index: "a1" }),
      ],
      a.binding.onChange,
    );
    expect([...b.doc.getMap("whiteboard").keys()]).toEqual(["ok"]);
    expect(ids(a.scene)).toContain("frame");
  });

  it("shares only http(s) links", () => {
    const linked = (link: string) =>
      (
        storable({ ...element("e"), link } as Element) as unknown as {
          link: unknown;
        }
      ).link;
    expect(linked("https://example.edu")).toBe("https://example.edu");
    expect(linked("javascript:alert(1)")).toBeNull();
    expect(linked("about:blank")).toBeNull();
  });
});

describe("describeBoard", () => {
  it("summarizes the visible elements in plain language", () => {
    expect(describeBoard([])).toBe("Whiteboard is empty");
    expect(
      describeBoard([
        element("a", { type: "arrow" }),
        element("r", { type: "rectangle" }),
        element("r2", { type: "rectangle" }),
        element("gone", { type: "ellipse", isDeleted: true }),
        element("t", { type: "text" }),
      ]),
    ).toBe("Whiteboard has 2 rectangles, 1 arrow and 1 text box");
    expect(describeBoard([element("d", { type: "freedraw" })])).toBe(
      "Whiteboard has 1 drawing",
    );
  });
});

describe("pointerCollaborators", () => {
  it("maps other participants' pointers to named, colored collaborators", () => {
    const pointer = {
      x: 4,
      y: 5,
      tool: "pointer" as const,
      button: "down" as const,
    };
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { name: "Me", color: "#000" }, whiteboardPointer: pointer }],
      [
        2,
        {
          user: { name: "Tim TA", color: "#c2410c" },
          whiteboardPointer: pointer,
        },
      ],
      [3, { user: { name: "Ada", color: "#047857" }, whiteboardPointer: null }],
      [4, { user: { name: "Bea", color: "#047857" } }],
      [5, { whiteboardPointer: pointer }],
    ]);
    const collaborators = pointerCollaborators(states, 1);
    expect([...collaborators.keys()]).toEqual(["2"]);
    expect(collaborators.get("2")).toEqual({
      id: "2",
      username: "Tim TA",
      color: { background: "#c2410c", stroke: "#c2410c" },
      pointer: { x: 4, y: 5, tool: "pointer" },
      button: "down",
    });
  });
});
