import * as Y from "yjs";

export const WHITEBOARD_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
]);
export const MAX_WHITEBOARD_ELEMENTS = 5_000;
export const MAX_ELEMENT_BYTES = 64 * 1024;
export const MAX_FREEDRAW_POINTS = 10_000;
export const MAX_TEXT_CHARACTERS = 10_000;
export const MAX_LINK_CHARACTERS = 2_048;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export type WhiteboardElement = Record<string, unknown> & {
  id: string;
  type: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array) &&
  !(value instanceof Y.AbstractType);

function validLink(link: unknown) {
  if (link === undefined || link === null) return true;
  if (typeof link !== "string" || link.length > MAX_LINK_CHARACTERS)
    return false;
  try {
    const { protocol } = new URL(link);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const absent = (value: unknown) => value === undefined || value === null;

/** Whether one stored whiteboard entry is an element the board may hold. */
export function validElement(
  key: string,
  value: unknown,
): value is WhiteboardElement {
  if (!isPlainObject(value)) return false;
  if (value.id !== key || typeof value.type !== "string") return false;
  if (!WHITEBOARD_ELEMENT_TYPES.has(value.type)) return false;
  if (!validLink(value.link)) return false;
  if (!absent(value.fileId) || !absent(value.customData)) return false;
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_ELEMENT_BYTES)
    return false;
  if (
    value.type === "freedraw" &&
    (!Array.isArray(value.points) || value.points.length > MAX_FREEDRAW_POINTS)
  )
    return false;
  for (const field of ["text", "originalText"])
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" ||
        (value[field] as string).length > MAX_TEXT_CHARACTERS)
    )
      return false;
  return true;
}

/**
 * Applies `update` to a scratch copy of `document` and reports whether the
 * result is a document the server may keep: only the code text and the
 * whiteboard map, within their limits. Only whiteboard entries the update
 * changes are revalidated.
 */
export function acceptsUpdate(
  document: Y.Doc,
  update: Uint8Array,
  maxCharacters: number,
): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(document));
    const board = probe.getMap("whiteboard");
    const changed = new Set<string>();
    board.observe((event) => {
      for (const key of event.keysChanged) changed.add(key);
    });
    Y.applyUpdate(probe, update);
    if (
      [...probe.share.keys()].some(
        (key) => key !== "content" && key !== "whiteboard",
      )
    )
      return false;
    if (probe.getText("content").length > maxCharacters) return false;
    // A root written as a list or text keeps its content outside the map view.
    if (board._start !== null) return false;
    if (board.size > MAX_WHITEBOARD_ELEMENTS) return false;
    for (const key of changed)
      if (board.has(key) && !validElement(key, board.get(key))) return false;
    return Y.encodeStateAsUpdate(probe).byteLength <= MAX_DOCUMENT_BYTES;
  } finally {
    probe.destroy();
  }
}

/** The board's non-deleted elements in drawing order. */
export function whiteboardProjection(document: Y.Doc): WhiteboardElement[] {
  const elements: WhiteboardElement[] = [];
  for (const [key, value] of document.getMap("whiteboard"))
    if (validElement(key, value) && value.isDeleted !== true)
      elements.push(value);
  const indexOf = (element: WhiteboardElement) =>
    typeof element.index === "string" ? element.index : "";
  return elements.sort((a, b) => {
    const left = indexOf(a);
    const right = indexOf(b);
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
