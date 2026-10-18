import * as Y from "yjs";

export const MAX_YJS_UPDATE_BYTES = 16 * 1024 * 1024;
export const MAX_YJS_STATE_BYTES = 64 * 1024 * 1024;
export const MAX_LIVE_TEXT_LENGTH = 100_000;

export class ContentUpdateError extends Error {
  constructor(readonly code: "invalid_update" | "invalid_content") {
    super(code);
  }
}

export type PreviewedContentUpdate = {
  state: Uint8Array;
  text: string;
  binaryChanged: boolean;
  textChanged: boolean;
};

/** Preview an untrusted update against the latest committed complete state. */
export function previewContentUpdate(
  previous: Uint8Array,
  update: Uint8Array,
): PreviewedContentUpdate {
  if (
    !(update instanceof Uint8Array) ||
    update.length === 0 ||
    update.length > MAX_YJS_UPDATE_BYTES
  )
    throw new ContentUpdateError("invalid_update");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, previous);
    const content = doc.getText("content");
    const original = content.toString();
    try {
      Y.applyUpdate(doc, update);
    } catch {
      throw new ContentUpdateError("invalid_update");
    }
    if (doc.share.size !== 1 || !doc.share.has("content"))
      throw new ContentUpdateError("invalid_content");
    if (
      content
        .toDelta()
        .some(
          (part: { insert?: unknown; attributes?: unknown }) =>
            typeof part.insert !== "string" || part.attributes !== undefined,
        )
    )
      throw new ContentUpdateError("invalid_content");
    const text = content.toString();
    if (text.length > MAX_LIVE_TEXT_LENGTH)
      throw new ContentUpdateError("invalid_content");
    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > MAX_YJS_STATE_BYTES)
      throw new ContentUpdateError("invalid_content");
    return {
      state,
      text,
      binaryChanged: !Buffer.from(state).equals(Buffer.from(previous)),
      textChanged: text !== original,
    };
  } finally {
    doc.destroy();
  }
}
