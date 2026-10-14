import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { previewContentUpdate } from "./update.js";

function base(text = "Initial") {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

function changed(state: Uint8Array, change: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  change(doc);
  return Y.encodeStateAsUpdate(doc);
}

describe("previewContentUpdate", () => {
  it("merges a valid update and allows a temporary empty body", () => {
    const state = base("Initial");
    const update = changed(state, (doc) =>
      doc.getText("content").delete(0, "Initial".length),
    );
    const result = previewContentUpdate(state, update);
    expect(result.text).toBe("");
    expect(result.textChanged).toBe(true);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, result.state);
    expect(decoded.getText("content").toString()).toBe("");
  });

  it("does not mark a replayed update as a text change", () => {
    const state = base();
    const update = changed(state, (doc) =>
      doc.getText("content").insert(7, " more"),
    );
    const once = previewContentUpdate(state, update);
    const twice = previewContentUpdate(once.state, update);
    expect(once.textChanged).toBe(true);
    expect(twice.textChanged).toBe(false);
    expect(twice.binaryChanged).toBe(false);
  });

  it("rejects a second shared type and malformed bytes", () => {
    const state = base();
    const extra = changed(state, (doc) =>
      doc.getMap("metadata").set("user", "spoof"),
    );
    expect(() => previewContentUpdate(state, extra)).toThrow("invalid_content");
    expect(() => previewContentUpdate(state, Uint8Array.from([255]))).toThrow(
      "invalid_update",
    );
  });

  it("rejects embedded and nested Yjs values in plain Markdown content", () => {
    const state = base("Plain $x^2$ Markdown");
    for (const embedded of [new Y.Map(), new Y.Array(), { nested: true }]) {
      if (embedded instanceof Y.Map) embedded.set("nested", new Y.Array());
      const update = changed(state, (doc) =>
        doc.getText("content").insertEmbed(0, embedded),
      );
      expect(() => previewContentUpdate(state, update)).toThrow(
        "invalid_content",
      );
      const unchanged = new Y.Doc();
      Y.applyUpdate(unchanged, state);
      expect(unchanged.getText("content").toString()).toBe(
        "Plain $x^2$ Markdown",
      );
      unchanged.destroy();
    }
  });

  it("enforces the update and projected-text limits", () => {
    const state = base();
    expect(() =>
      previewContentUpdate(state, new Uint8Array(16 * 1024 * 1024 + 1)),
    ).toThrow("invalid_update");
    const long = changed(state, (doc) =>
      doc.getText("content").insert(7, "a".repeat(100_000)),
    );
    expect(() => previewContentUpdate(state, long)).toThrow("invalid_content");
  });
});
