import { expect, it } from "vitest";
import { renderAttachedImage } from "./images.js";
it("waits for timed-out image IO cleanup instead of abandoning its read", async () => {
  let release!: () => void;
  const cleanup = new Promise<void>((done) => {
    release = done;
  });
  let aborted!: () => void;
  const abortSeen = new Promise<void>((done) => {
    aborted = done;
  });
  let completed = false;
  const rendering = renderAttachedImage({
    filename: "test.png",
    url: "private",
    sizeBytes: 1,
    read: async (signal) => {
      await new Promise<void>((done) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            done();
          },
          { once: true },
        ),
      );
      await cleanup;
      return undefined;
    },
  }).then((value) => {
    completed = true;
    return value;
  });
  await abortSeen;
  await new Promise((done) => setImmediate(done));
  try {
    expect(completed).toBe(false);
  } finally {
    release();
    await rendering;
  }
});
