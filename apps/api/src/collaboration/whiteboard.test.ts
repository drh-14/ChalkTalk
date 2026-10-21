import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MAX_WHITEBOARD_ELEMENTS,
  WHITEBOARD_ELEMENT_TYPES,
  acceptsUpdate,
  whiteboardProjection,
} from "./whiteboard.js";

const LIMIT = 200_000;

function element(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    index: "a0",
    isDeleted: false,
    link: null,
    ...overrides,
  };
}

/** The update produced by `change` on a client copy of `server`. */
function updateFrom(server: Y.Doc, change: (client: Y.Doc) => void) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(client);
  change(client);
  return Y.encodeStateAsUpdate(client, before);
}

const write =
  (value: unknown, id = "e1") =>
  (client: Y.Doc) =>
    client.getMap("whiteboard").set(id, value);

describe("whiteboard validation", () => {
  it.each([...WHITEBOARD_ELEMENT_TYPES])("accepts a %s element", (type) => {
    const extra =
      type === "freedraw"
        ? { points: [[0, 0]] }
        : type === "text"
          ? { text: "hi", originalText: "hi" }
          : {};
    const server = new Y.Doc();
    expect(
      acceptsUpdate(
        server,
        updateFrom(server, write(element("e1", { type, ...extra }))),
        LIMIT,
      ),
    ).toBe(true);
  });

  it("accepts code edits, deletions, and http(s) links", () => {
    const server = new Y.Doc();
    Y.applyUpdate(server, updateFrom(server, write(element("e1"))));
    for (const change of [
      (client: Y.Doc) => client.getText("content").insert(0, "print(1)"),
      (client: Y.Doc) => client.getMap("whiteboard").delete("e1"),
      write(element("e2", { link: "https://example.edu/notes" }), "e2"),
      write(element("e3", { link: "http://example.edu" }), "e3"),
    ])
      expect(acceptsUpdate(server, updateFrom(server, change), LIMIT)).toBe(
        true,
      );
  });

  it.each([
    ["an image", element("e1", { type: "image" })],
    ["an embeddable", element("e1", { type: "embeddable" })],
    ["an iframe", element("e1", { type: "iframe" })],
    ["a frame", element("e1", { type: "frame" })],
    ["a javascript: link", element("e1", { link: "javascript:alert(1)" })],
    ["a data: link", element("e1", { link: "data:text/html,x" })],
    ["a relative link", element("e1", { link: "/notes" })],
    [
      "an overlong link",
      element("e1", { link: `https://example.edu/${"a".repeat(2_048)}` }),
    ],
    ["a file reference", element("e1", { fileId: "f1" })],
    ["custom data", element("e1", { customData: { a: 1 } })],
    ["a mismatched id", element("other")],
    ["a missing type", { id: "e1" }],
    ["a non-object", "rectangle"],
    ["an array", [element("e1")]],
    ["binary content", new Uint8Array([1, 2, 3])],
    [
      "an element over 64 KiB",
      element("e1", { strokeColor: "x".repeat(65 * 1024) }),
    ],
    [
      "a freedraw with too many points",
      element("e1", {
        type: "freedraw",
        points: Array.from({ length: 10_001 }, () => [0, 0]),
      }),
    ],
    ["a freedraw without points", element("e1", { type: "freedraw" })],
    [
      "text over 10,000 characters",
      element("e1", { type: "text", text: "t".repeat(10_001) }),
    ],
  ])("rejects %s", (_name, value) => {
    const server = new Y.Doc();
    expect(acceptsUpdate(server, updateFrom(server, write(value)), LIMIT)).toBe(
      false,
    );
  });

  it("rejects nested shared types and other roots", () => {
    const server = new Y.Doc();
    for (const change of [
      write(new Y.Map()),
      (client: Y.Doc) => client.getMap("other").set("x", 1),
      (client: Y.Doc) => client.getArray("whiteboard").insert(0, [1]),
    ])
      expect(acceptsUpdate(server, updateFrom(server, change), LIMIT)).toBe(
        false,
      );
  });

  it("rejects a board above 5,000 elements but accepts one at the limit", () => {
    const server = new Y.Doc();
    Y.applyUpdate(
      server,
      updateFrom(server, (client) => {
        const board = client.getMap("whiteboard");
        for (let i = 0; i < MAX_WHITEBOARD_ELEMENTS - 1; i++)
          board.set(`e${i}`, element(`e${i}`, { isDeleted: i % 2 === 0 }));
      }),
    );
    const last = `e${MAX_WHITEBOARD_ELEMENTS - 1}`;
    const atLimit = updateFrom(server, write(element(last), last));
    expect(acceptsUpdate(server, atLimit, LIMIT)).toBe(true);
    Y.applyUpdate(server, atLimit);
    expect(
      acceptsUpdate(
        server,
        updateFrom(server, write(element("x"), "x")),
        LIMIT,
      ),
    ).toBe(false);
  });

  it("rejects a document above 5 MiB", () => {
    const server = new Y.Doc();
    Y.applyUpdate(
      server,
      updateFrom(server, (client) => {
        const board = client.getMap("whiteboard");
        for (let i = 0; i < 83; i++)
          board.set(
            `e${i}`,
            element(`e${i}`, { strokeColor: "x".repeat(63_000) }),
          );
      }),
    );
    const add = (id: string, size: number) =>
      acceptsUpdate(
        server,
        updateFrom(
          server,
          write(element(id, { strokeColor: "x".repeat(size) }), id),
        ),
        LIMIT,
      );
    expect(add("small", 10)).toBe(true);
    expect(add("big", 63_000)).toBe(false);
  });

  it("does not change the document it checks", () => {
    const server = new Y.Doc();
    acceptsUpdate(
      server,
      updateFrom(server, write(element("e1", { type: "image" }))),
      LIMIT,
    );
    expect(server.getMap("whiteboard").size).toBe(0);
  });
});

describe("whiteboard projection", () => {
  it("lists non-deleted elements by index, then id", () => {
    const document = new Y.Doc();
    const board = document.getMap("whiteboard");
    board.set("c", element("c", { index: "a1" }));
    board.set("b", element("b", { index: "a0" }));
    board.set("a", element("a", { index: "a1" }));
    board.set("gone", element("gone", { index: "Zz", isDeleted: true }));
    expect(whiteboardProjection(document).map(({ id }) => id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
