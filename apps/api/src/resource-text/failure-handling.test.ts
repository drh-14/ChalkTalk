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
  tools.responses.pdfimages = () => result();
  tools.responses.pdftoppm = async (args) => {
    await writeFile(`${args.at(-1)}.png`, "rendered");
    return result();
  };
}
const extractPdf = (
  options: {
    deadline?: number;
    maxOcrPages?: number;
    onProgress?: (progress: {
      phase: string;
      completedPages: number | null;
      totalPages: number | null;
    }) => Promise<void>;
  } = {},
) =>
  withTempDirectory((directory) =>
    extractPdfText("source.pdf", directory, {
      maxOcrPages: 200,
      ocrLanguages: "eng",
      ...options,
    }),
  );
const longLine = "text layer words that are long enough to be usable";
const footer =
  "Reproduced with permission of the copyright owner. Further reproduction prohibited without permission.";
const dense = "dense ".repeat(120).trim();
const articleSentence =
  "Recognized article body about civic culture and democracy.";
const articleBody = `${articleSentence}${" The scanned page continues with many further paragraphs of argument.".repeat(4)}`;
const imageRow = (page: number, type = "image", ppi = "300") =>
  `${page} 0 ${type} 2550 3300 gray 1 1 ccitt no 8 0 ${ppi} ${ppi} 101K 10%`;
const listImages = (...rows: string[]) => {
  tools.responses.pdfimages = () =>
    result({
      stdout: Buffer.from(
        `page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n${rows.join("\n")}\n`,
      ),
    });
};
const occurrences = (text: string, part: string) => text.split(part).length - 1;

beforeEach(() => {
  tools.responses = {};
});
afterEach(() => {
  vi.useRealTimers();
});

describe("scanned article pages with selectable footers", () => {
  it.each(["image", "stencil"])(
    "OCRs a page-sized %s despite a selectable copyright footer",
    async (type) => {
      pdfWith(1, { 0: footer });
      listImages(imageRow(1, type));
      tools.responses.tesseract = () =>
        result({
          stdout: Buffer.from(`${articleBody}\n${footer}`),
        });
      const extracted = await extractPdf();
      expect(extracted.ocrPageCount).toBe(1);
      expect(occurrences(extracted.text, articleSentence)).toBe(1);
      expect(occurrences(extracted.text, footer)).toBe(1);
      expect(extracted.truncated).toBe(false);
    },
  );

  it("keeps the selectable text when OCR of the page recognizes nothing", async () => {
    pdfWith(1, { 0: footer });
    listImages(imageRow(1));
    tools.responses.tesseract = () => result();
    expect(await extractPdf()).toMatchObject({
      text: footer,
      ocrPageCount: 1,
    });
  });
});

describe("image-backed slides with selectable text", () => {
  const slide = "Exact slide code and formula text ".repeat(10).trim();

  it.each([
    ["noise", "g@rbled n0ise"],
    ["less text", "Exact slide code"],
    ["the same amount of misread text", slide.toUpperCase()],
    ["slightly more misread text", `${slide.replaceAll("e", "c")} 0x1l O0`],
  ])("keeps the exact selectable text when OCR returns %s", async (_, ocr) => {
    pdfWith(1, { 0: slide });
    listImages(imageRow(1));
    tools.responses.tesseract = () => result({ stdout: Buffer.from(ocr) });
    expect(await extractPdf()).toMatchObject({ text: slide, ocrPageCount: 1 });
  });

  // The slide layer has 280 non-whitespace characters, so the spec's rule of
  // 1.5 times the layer plus 20 needs OCR to recognize more than 440 of them.
  it.each([
    ["keeps the layer at exactly the margin", 440, slide],
    ["takes OCR one character past the margin", 441, "x".repeat(441)],
  ])("%s", async (_, length, stored) => {
    pdfWith(1, { 0: slide });
    listImages(imageRow(1));
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from("x".repeat(length)) });
    expect(await extractPdf()).toMatchObject({ text: stored, ocrPageCount: 1 });
  });

  it("takes the OCR text alone when it recognizes far more than the slide layer", async () => {
    pdfWith(1, { 0: slide });
    listImages(imageRow(1));
    const recognized = `${slide} ${"plus words only the image contains ".repeat(8).trim()}`;
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from(recognized) });
    expect(await extractPdf()).toMatchObject({
      text: recognized,
      ocrPageCount: 1,
    });
  });
});

describe("pages without usable selectable text", () => {
  it("takes short OCR text on a page with no text layer", async () => {
    pdfWith(1);
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from("Figure 1") });
    expect(await extractPdf()).toMatchObject({
      text: "Figure 1",
      ocrPageCount: 1,
    });
  });

  it("takes OCR text only slightly longer than an unusable page number", async () => {
    pdfWith(1, { 0: "12" });
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from("12 Figure") });
    expect(await extractPdf()).toMatchObject({
      text: "12 Figure",
      ocrPageCount: 1,
    });
  });
});

describe("unreadable pdfimages listings fall back to the text layer", () => {
  it.each(["inf", "nan", "-"])(
    "skips an image row whose ppi is %s and still extracts the PDF",
    async (ppi) => {
      pdfWith(1, { 0: footer });
      listImages(imageRow(1, "image", ppi));
      expect(await extractPdf()).toMatchObject({
        text: footer,
        ocrPageCount: 0,
        truncated: false,
      });
    },
  );

  it("still OCRs a page with a measurable scan beside an unmeasurable watermark", async () => {
    pdfWith(1, { 0: footer });
    listImages(imageRow(1, "image", "inf"), imageRow(1));
    const recognized = `${articleBody} ${footer}`;
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from(recognized) });
    expect(await extractPdf()).toMatchObject({
      text: recognized,
      ocrPageCount: 1,
    });
  });

  it("uses the text layer when the listing overflows the output cap", async () => {
    pdfWith(1, { 0: footer });
    tools.responses.pdfimages = () =>
      result({
        code: null,
        truncated: true,
        stdout: Buffer.from(imageRow(1)),
      });
    expect(await extractPdf()).toMatchObject({
      text: footer,
      ocrPageCount: 0,
      truncated: false,
    });
  });
});

describe("OCR cap on a page with selectable text", () => {
  it("does not mark the document truncated when only that page goes unread", async () => {
    pdfWith(3, { 0: dense, 1: footer, 2: dense });
    listImages(imageRow(2));
    const extracted = await extractPdf({ maxOcrPages: 0 });
    expect(extracted).toMatchObject({ truncated: false, ocrPageCount: 0 });
    expect(extracted.text).toContain(footer);
  });

  it("marks truncation when the cap leaves a scan unread after an earlier OCR", async () => {
    pdfWith(2, { 0: footer, 1: footer });
    listImages(imageRow(1, "stencil"), imageRow(2, "stencil"));
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from(`Recognized article body. ${footer}`) });
    expect(await extractPdf({ maxOcrPages: 1 })).toMatchObject({
      truncated: true,
      pageCount: 2,
      ocrPageCount: 1,
    });
  });

  it("marks truncation when the deadline leaves a scan unread after an earlier OCR", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    pdfWith(2, { 0: footer, 1: footer });
    listImages(imageRow(1), imageRow(2));
    tools.responses.tesseract = () => {
      vi.setSystemTime(2_000_000);
      return result({
        stdout: Buffer.from(`Recognized article body. ${footer}`),
      });
    };
    expect(await extractPdf({ deadline: 1_500_000 })).toMatchObject({
      truncated: true,
      ocrPageCount: 1,
    });
  });

  it("marks truncation when a later page also needed OCR", async () => {
    pdfWith(3, { 0: footer, 1: dense, 2: footer });
    listImages(imageRow(1), imageRow(3));
    expect(await extractPdf({ maxOcrPages: 0 })).toMatchObject({
      truncated: true,
      ocrPageCount: 0,
    });
  });

  it("marks truncation when the unread page has no usable text", async () => {
    pdfWith(2, { 0: dense });
    expect(await extractPdf({ maxOcrPages: 0 })).toMatchObject({
      truncated: true,
      ocrPageCount: 0,
    });
  });
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
    tools.responses.pdfimages = () => result();
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

describe("truthful OCR work progress", () => {
  it("counts OCR work before the cap and awaits every completed page", async () => {
    pdfWith(4, { 0: dense, 2: dense });
    tools.responses.tesseract = () =>
      result({ stdout: Buffer.from("recognized page") });
    const progress: unknown[] = [];
    const extracted = await extractPdf({
      maxOcrPages: 1,
      onProgress: async (value) => {
        await Promise.resolve();
        progress.push(value);
      },
    });
    expect(progress).toEqual([
      { phase: "ocr", completedPages: 0, totalPages: 2 },
      { phase: "ocr", completedPages: 1, totalPages: 2 },
    ]);
    expect(extracted).toMatchObject({ truncated: true, ocrPageCount: 1 });
  });
  it("never fabricates OCR progress for text-only PDFs", async () => {
    pdfWith(2, { 0: dense, 1: dense });
    const onProgress = vi.fn();
    await extractPdf({ onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });
  it("stops extraction when an awaited progress write loses ownership", async () => {
    pdfWith(2);
    const tesseract = vi.fn(() => result());
    tools.responses.tesseract = tesseract;
    await expect(
      extractPdf({
        onProgress: async () => {
          throw Error("lease lost");
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(tesseract).not.toHaveBeenCalled();
  });
});
