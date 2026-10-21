import * as Y from "yjs";

/** The element fields the binding reads; everything else is carried as is. */
export type BoardElement = {
  readonly id: string;
  readonly version: number;
  readonly versionNonce: number;
  readonly index?: string | null;
  readonly isDeleted?: boolean;
};

export type BoardScene<Element extends BoardElement> = {
  getSceneElementsIncludingDeleted(): readonly Element[];
  updateScene(scene: {
    elements: readonly Element[];
    captureUpdate: never;
  }): void;
};

export type PointerState = {
  x: number;
  y: number;
  tool: "pointer" | "laser";
  button: "up" | "down";
};

export type BoardCollaborator = {
  id: string;
  username: string;
  color: { background: string; stroke: string };
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "up" | "down";
};

const LOCAL = Symbol("whiteboard-local");

/** Excalidraw's rule: the higher version wins, then the lower nonce. */
export const beats = (a: BoardElement, b: BoardElement) =>
  a.version > b.version ||
  (a.version === b.version && a.versionNonce < b.versionNonce);

/** Drawing order: fractional index, then id, compared as plain strings. */
export function inDrawingOrder<Element extends BoardElement>(
  elements: Iterable<Element>,
): Element[] {
  const key = (element: Element) => element.index ?? "";
  return [...elements].sort((a, b) => {
    if (key(a) !== key(b)) return key(a) < key(b) ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// The collaboration server's whiteboard rules; an update that breaks them
// closes the connection, so such elements stay on this screen only.
const STORABLE_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
]);
const MAX_ELEMENT_BYTES = 64 * 1024;
const MAX_POINTS = 10_000;
const MAX_TEXT = 10_000;
const MAX_ELEMENTS = 5_000;

function safeLink(link: unknown) {
  if (typeof link !== "string" || link.length > 2_048) return null;
  try {
    const { protocol } = new URL(link);
    return protocol === "http:" || protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

/** The copy of an element to share, or null if the server would reject it. */
export function storable<Element extends BoardElement>(
  element: Element,
): Element | null {
  const value = element as unknown as Record<string, unknown>;
  if (typeof value.type !== "string" || !STORABLE_TYPES.has(value.type))
    return null;
  if (value.fileId != null || value.customData != null) return null;
  if (
    value.type === "freedraw" &&
    (!Array.isArray(value.points) || value.points.length > MAX_POINTS)
  )
    return null;
  for (const field of ["text", "originalText"])
    if (typeof value[field] === "string" && value[field].length > MAX_TEXT)
      return null;
  const copy = {
    ...value,
    link: value.link == null ? value.link : safeLink(value.link),
  };
  if (new TextEncoder().encode(JSON.stringify(copy)).length > MAX_ELEMENT_BYTES)
    return null;
  return copy as unknown as Element;
}

/**
 * Keeps an Excalidraw scene and `Y.Map('whiteboard')` in step. Each element
 * is stored whole under its id. Remote changes are applied with
 * `captureUpdate` set to `never` so they stay out of local undo; when Yjs
 * keeps a concurrent lower version, the higher local copy is written back so
 * every replica converges on the same element.
 */
export function bindWhiteboard<Element extends BoardElement>(
  board: Y.Map<unknown>,
  scene: BoardScene<Element>,
  captureNever: unknown,
) {
  const doc = board.doc!;
  const stored = (id: string) => board.get(id) as Element | undefined;

  function write(elements: Iterable<Element>) {
    doc.transact(() => {
      for (const element of elements) {
        const copy = storable(element);
        if (!copy || (!board.has(element.id) && board.size >= MAX_ELEMENTS))
          continue;
        board.set(element.id, copy);
      }
    }, LOCAL);
  }

  function apply(changed: Iterable<string> | null) {
    const local = new Map(
      scene
        .getSceneElementsIncludingDeleted()
        .map((element) => [element.id, element]),
    );
    const keys = changed ?? board.keys();
    const reassert: Element[] = [];
    let touched = false;
    for (const id of keys) {
      const remote = stored(id);
      const current = local.get(id);
      if (!remote) {
        if (current) {
          local.delete(id);
          touched = true;
        }
      } else if (!current || beats(remote, current)) {
        local.set(id, remote);
        touched = true;
      } else if (beats(current, remote)) reassert.push(current);
    }
    if (touched)
      scene.updateScene({
        elements: inDrawingOrder(local.values()),
        captureUpdate: captureNever as never,
      });
    if (reassert.length) write(reassert);
  }

  const observer = (event: Y.YMapEvent<unknown>) => {
    if (event.transaction.origin !== LOCAL) apply(event.keysChanged);
  };
  board.observe(observer);
  apply(null);

  return {
    /** Pass Excalidraw's `onChange` elements; only changed versions are written. */
    onChange(elements: readonly Element[]) {
      const changed = elements.filter((element) => {
        const previous = stored(element.id);
        return !previous || beats(element, previous);
      });
      if (changed.length) write(changed);
    },
    destroy() {
      board.unobserve(observer);
    },
  };
}

type AwarenessState = {
  user?: { name?: string; color?: string };
  whiteboardPointer?: PointerState | null;
};

/** Other participants' whiteboard pointers, named and colored by the server. */
export function pointerCollaborators(
  states: ReadonlyMap<number, Record<string, unknown>>,
  selfClientId: number,
): Map<string, BoardCollaborator> {
  const collaborators = new Map<string, BoardCollaborator>();
  for (const [clientId, raw] of states) {
    const state = raw as AwarenessState;
    const pointer = state.whiteboardPointer;
    if (clientId === selfClientId || !pointer || !state.user?.name) continue;
    const color = state.user.color ?? "#1d4ed8";
    collaborators.set(String(clientId), {
      id: String(clientId),
      username: state.user.name,
      color: { background: color, stroke: color },
      pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
      button: pointer.button,
    });
  }
  return collaborators;
}

/** The PNG download name for a session's whiteboard. */
export function whiteboardFileName(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "session"}-whiteboard.png`;
}

const KIND_NAMES: Record<string, [string, string]> = {
  rectangle: ["rectangle", "rectangles"],
  ellipse: ["ellipse", "ellipses"],
  diamond: ["diamond", "diamonds"],
  line: ["line", "lines"],
  arrow: ["arrow", "arrows"],
  freedraw: ["drawing", "drawings"],
  text: ["text box", "text boxes"],
};

/** A plain-language summary of what is on the board, for screen readers. */
export function describeBoard(
  elements: readonly (BoardElement & { readonly type?: string })[],
) {
  const counts = new Map<string, number>();
  for (const element of elements)
    if (!element.isDeleted && element.type && KIND_NAMES[element.type])
      counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  const parts = Object.keys(KIND_NAMES)
    .filter((type) => counts.has(type))
    .map((type) => {
      const count = counts.get(type)!;
      return `${count} ${KIND_NAMES[type]![count === 1 ? 0 : 1]}`;
    });
  if (!parts.length) return "Whiteboard is empty";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Whiteboard has ${list}`;
}
