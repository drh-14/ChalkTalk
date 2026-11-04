import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractImageText, ocrImage } from "./image.js";
import { extractPdfText } from "./pdf.js";
import { withTempDirectory, type ToolResult } from "./tools.js";

const tools = vi.hoisted(() => ({
  responses: {} as Record<string, (args: string[]) => unknown>,
}));
vi.mock("./tools.js", async (original) => ({
  ...(await original<typeof import("./tools.js")>()),
  runTool: async (command: string, args: string[]) => {
    const respond = tools.responses[command];
    if (!respond) throw new Error(`Unexpected tool ${command}`);
    return respond(args);
  },
}));

const result = (overrides: Partial<ToolResult> = {}): ToolResult => ({
  code: 0,
  stdout: Buffer.alloc(0),
  stderr: "",
  truncated: false,
  ...overrides,
});
const killed = () => result({ code: null });

/** A PDF with `pages` pages whose text layer holds `layer[page]`, rendering each page to a file. */
function pdfWith(pages: number, layer: Record<number, string> = {}) {
  tools.responses.pdfinfo = () =>
    result({
      stdout: Buffer.from(
        `Pages: ${pages}\n` +
          Array.from(
            { length: pages },
            (_, page) => `Page ${page + 1} size: 612 x 792 pts\n`,
          ).join(""),
      ),
    });
  tools.responses.pdftotext = () =>
    result({
      stdout: Buffer.from(
        Array.from({ length: pages }, (_, page) => layer[page] ?? "").join(
          "\f",
        ) + "\f",
      ),
    });
  tools.responses.pdftoppm = async (args) => {
    await writeFile(`${args.at(-1)}.png`, "rendered");
    return result();
  };
}
const extractPdf = (
  options: { deadline?: number; maxOcrPages?: number } = {},
) =>
  withTempDirectory((directory) =>
    extractPdfText("source.pdf", directory, {
      maxOcrPages: 200,
      ocrLanguages: "eng",
      ...options,
    }),
  );
const longLine = "text layer words that are long enough to be usable";

beforeEach(() => {
  tools.responses = {};
});
afterEach(() => {
  vi.useRealTimers();
});

describe("transient tool failures stay retryable", () => {
  it("does not treat a killed or failing tesseract as a property of the file", async () => {
    for (const outcome of [
      killed(),
      result({ code: 1, stderr: "out of mem" }),
    ]) {
      tools.responses.tesseract = () => outcome;
      await expect(ocrImage("page.png", "eng")).rejects.toMatchObject({
        code: "ocr_failed",
        permanent: false,
      });
    }
  });

  it("retries a failed page render", async () => {
    pdfWith(1);
    tools.responses.pdftoppm = () =>
      result({ code: 99, stderr: "No space left on device" });
    await expect(extractPdf()).rejects.toMatchObject({
      code: "render_failed",
      permanent: false,
    });
  });

  it("retries pdfinfo and pdftotext when they are killed", async () => {
    tools.responses.pdfinfo = killed;
    await expect(extractPdf()).rejects.toMatchObject({
      code: "tool_killed",
      permanent: false,
    });
    pdfWith(1);
    tools.responses.pdftotext = killed;
    await expect(extractPdf()).rejects.toMatchObject({
      code: "tool_killed",
      permanent: false,
    });
  });

  it("names a killed tool in the failure message even with no stderr", async () => {
    tools.responses.tesseract = killed;
    await expect(ocrImage("page.png", "eng")).rejects.toThrow("ocr_failed");
  });

  it("retries when the prepared image cannot be written", async () => {
    await withTempDirectory(async (directory) => {
      const path = join(directory, "photo.png");
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: "white" },
      })
        .png()
        .toFile(path);
      const failure = await extractImageText(
        path,
        join(directory, "missing"),
        "eng",
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "ENOENT" });
      expect(failure).not.toHaveProperty("permanent");
    });
  });
});

describe("proven file conditions stay permanent", () => {
  it("fails encrypted and invalid PDFs immediately", async () => {
    tools.responses.pdfinfo = () =>
      result({ code: 1, stderr: "Command Line Error: Incorrect password" });
    await expect(extractPdf()).rejects.toMatchObject({
      code: "encrypted_pdf",
      permanent: true,
    });
    tools.responses.pdfinfo = () =>
      result({ code: 1, stderr: "Syntax Error: Couldn't find trailer" });
    await expect(extractPdf()).rejects.toMatchObject({
      code: "damaged_file",
      permanent: true,
    });
  });

  it("fails an undecodable image immediately", async () => {
    await withTempDirectory(async (directory) => {
      const path = join(directory, "broken.png");
      await writeFile(path, "not an image");
      await expect(
        extractImageText(path, directory, "eng"),
      ).rejects.toMatchObject({ code: "damaged_file", permanent: true });
    });
  });
});

describe("OCR deadline", () => {
  it("OCRs every page and does not truncate without a deadline", async () => {
    pdfWith(3);
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from("recognized") });
    expect(await extractPdf()).toMatchObject({
      truncated: false,
      pageCount: 3,
      ocrPageCount: 3,
    });
  });

  it("stops at an already-passed deadline, keeping the text layer and marking truncation", async () => {
    pdfWith(3, { 0: longLine, 2: "layer on a page past the cutoff" });
    const tesseract = vi.fn(() => result());
    tools.responses.tesseract = tesseract;
    const extracted = await extractPdf({ deadline: Date.now() - 1 });
    expect(tesseract).not.toHaveBeenCalled();
    expect(extracted).toMatchObject({
      truncated: true,
      pageCount: 3,
      ocrPageCount: 0,
    });
    expect(extracted.text).toContain(longLine);
    expect(extracted.text).toContain("layer on a page past the cutoff");
  });

  it("keeps pages already OCR'd when the deadline passes mid-file", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    pdfWith(3);
    tools.responses.tesseract = (args) => {
      vi.setSystemTime(2_000_000);
      return result({ stdout: Buffer.from(`recognized ${args[0]}`) });
    };
    const extracted = await extractPdf({ deadline: 1_500_000 });
    expect(extracted).toMatchObject({ truncated: true, ocrPageCount: 1 });
    expect(extracted.text).toContain("page-1.png");
    expect(extracted.text).not.toContain("page-2.png");
  });
});

describe("scratch disk", () => {
  it.each(["", "Page 1 size: 0 x 792 pts\n"])(
    "does not render pages without usable dimensions: %s",
    async (dimensions) => {
      pdfWith(1);
      tools.responses.pdfinfo = () =>
        result({
          stdout: Buffer.from(`Pages: 1\n${dimensions}`),
        });
      const render = vi.fn(() => result());
      tools.responses.pdftoppm = render;
      await expect(extractPdf()).rejects.toMatchObject({
        code: "page_size_unavailable",
        permanent: false,
      });
      expect(render).not.toHaveBeenCalled();
    },
  );

  it.each(["Page 1 size: nan x nan pts\n", "", "Page 1 size: 0 x 792 pts\n"])(
    "extracts a text-layer page whose size is unusable: %s",
    async (dimensions) => {
      pdfWith(1, { 0: longLine });
      tools.responses.pdfinfo = () =>
        result({ stdout: Buffer.from(`Pages: 1\n${dimensions}`) });
      expect(await extractPdf()).toMatchObject({
        text: longLine,
        truncated: false,
        ocrPageCount: 0,
      });
    },
  );

  it("does not need a size for a page past the OCR page cap", async () => {
    pdfWith(1);
    tools.responses.pdfinfo = () =>
      result({ stdout: Buffer.from("Pages: 1\n") });
    expect(await extractPdf({ maxOcrPages: 0 })).toMatchObject({
      truncated: true,
      ocrPageCount: 0,
    });
  });

  it("holds at most one rendered page and removes it when OCR fails", async () => {
    pdfWith(3);
    const seen: string[][] = [];
    let directory = "";
    tools.responses.pdftoppm = async (args) => {
      directory = join(args.at(-1)!, "..");
      await writeFile(`${args.at(-1)}.png`, "rendered");
      return result();
    };
    let calls = 0;
    tools.responses.tesseract = async () => {
      seen.push(await readdir(directory));
      calls += 1;
      return calls === 3 ? result({ code: 1 }) : result();
    };
    await withTempDirectory(async (scratch) => {
      await expect(
        extractPdfText("source.pdf", scratch, {
          maxOcrPages: 200,
          ocrLanguages: "eng",
        }),
      ).rejects.toMatchObject({ code: "ocr_failed" });
      expect(await readdir(scratch)).toEqual([]);
    });
    expect(seen).toEqual([["page-1.png"], ["page-2.png"], ["page-3.png"]]);
  });
});
