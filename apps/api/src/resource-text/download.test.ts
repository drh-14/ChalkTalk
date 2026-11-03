import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { downloadObject } from "./download.js";
import { ExtractionFailure, withTempDirectory } from "./tools.js";

const storeReturning = (body: unknown) => ({
  client: { send: async () => ({ Body: body }) } as never,
  bucket: "bucket",
});
const signal = () => new AbortController().signal;

describe("downloadObject", () => {
  it("writes the object's bytes to the path", async () => {
    await withTempDirectory(async (directory) => {
      const path = join(directory, "source");
      await downloadObject(
        storeReturning(
          Readable.from([Buffer.from("lecture "), Buffer.from("notes")]),
        ),
        "key",
        path,
        signal(),
      );
      expect(await readFile(path, "utf8")).toBe("lecture notes");
    });
  });

  it("reports a body that stops mid-download as an outage", async () => {
    await withTempDirectory(async (directory) => {
      const body = new Readable({
        read() {
          this.push("partial");
          this.destroy(new Error("socket hang up"));
        },
      });
      await expect(
        downloadObject(
          storeReturning(body),
          "key",
          join(directory, "source"),
          signal(),
        ),
      ).rejects.toMatchObject({
        code: "object_store_unavailable",
        permanent: false,
      });
    });
  });

  it("keeps a scratch-disk write failure distinct from an outage and releases the body", async () => {
    await withTempDirectory(async (directory) => {
      const body = Readable.from([Buffer.from("bytes")]);
      const failure = await downloadObject(
        storeReturning(body),
        "key",
        join(directory, "missing", "source"),
        signal(),
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "ENOENT" });
      expect(body.destroyed).toBe(true);
    });
  });

  it("aborts a stalled body at the deadline and releases it", async () => {
    await withTempDirectory(async (directory) => {
      const controller = new AbortController();
      const body = new Readable({
        read() {
          controller.abort(new ExtractionFailure("extraction_timeout", false));
        },
      });
      try {
        await expect(
          downloadObject(
            storeReturning(body),
            "key",
            join(directory, "source"),
            controller.signal,
          ),
        ).rejects.toMatchObject({
          code: "object_store_unavailable",
          permanent: false,
        });
        expect(body.destroyed).toBe(true);
      } finally {
        body.destroy();
      }
    });
  });

  it.each([
    [
      "no HTTP response",
      { code: "ECONNREFUSED", $metadata: { attempts: 3 } },
      true,
    ],
    ["a 500", { $metadata: { httpStatusCode: 500 } }, true],
    ["a 503", { $metadata: { httpStatusCode: 503 } }, true],
    ["a 404", { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }, false],
    [
      "a 403",
      { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
      false,
    ],
  ])("classifies %s", async (_name, error, outage) => {
    const failure = await downloadObject(
      {
        client: {
          send: async () => {
            throw error;
          },
        } as never,
        bucket: "bucket",
      },
      "key",
      "unused",
      signal(),
    ).catch((caught: unknown) => caught);
    if (outage)
      expect(failure).toMatchObject({ code: "object_store_unavailable" });
    else expect(failure).toBe(error);
  });
});
