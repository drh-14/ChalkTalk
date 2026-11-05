import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ocrImage } from "./image.js";
import { MAX_TEXT_LENGTH } from "./normalize.js";
import { ExtractionFailure, runTool, type ToolResult } from "./tools.js";

/** A page with fewer non-whitespace characters than this is treated as scanned. */
export const USABLE_PAGE_TEXT = 20;
const SPARSE_PAGE_TEXT = 500;
const SCAN_IMAGE_COVERAGE = 0.5;
/**
 * OCR replaces usable selectable text only when it recognizes more than this
 * ratio of the layer plus this many non-whitespace characters. Noise on an
 * image-backed slide inflates OCR slightly; a scan's page body exceeds it clearly.
 */
const OCR_REPLACEMENT_RATIO = 1.5;
const OCR_REPLACEMENT_EXTRA = 20;
const TEXT_BATCH_PAGES = 50;
const MAX_RENDER_DPI = 300;
const MAX_RENDER_SIDE_PX = 4000;
/** pdfinfo prints sizes to six significant digits, so a real page can be slightly larger than reported. */
const REPORTED_SIZE_MARGIN = 1 - 1e-5;

type Options = {
  maxOcrPages: number;
  ocrLanguages: string;
  signal?: AbortSignal;
  deadline?: number;
  onProgress?: (progress: {
    phase: "ocr";
    completedPages: number;
    totalPages: number;
  }) => Promise<void>;
};

const failed = (result: ToolResult) =>
  result.code === null
    ? new ExtractionFailure("tool_killed", false)
    : /password/i.test(result.stderr)
      ? new ExtractionFailure("encrypted_pdf", true)
      : new ExtractionFailure(
          "damaged_file",
          true,
          result.stderr.slice(0, 500),
        );

/**
 * Reads the page count and each page's crop box size in points, leaving a page
 * without a usable size undefined. Encrypted or damaged files fail permanently.
 */
export async function pageSizes(path: string, signal?: AbortSignal) {
  const info = await runTool("pdfinfo", [path], { signal });
  if (info.code !== 0) throw failed(info);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info.stdout.toString())?.[1]);
  if (!Number.isInteger(pages))
    throw new ExtractionFailure("damaged_file", true);
  if (pages === 0) return [];
  const sized = await runTool(
    "pdfinfo",
    ["-f", "1", "-l", String(pages), path],
    { signal },
  );
  if (sized.code !== 0) throw failed(sized);
  const sizes: ({ width: number; height: number } | undefined)[] = Array.from({
    length: pages,
  });
  for (const match of sized.stdout
    .toString()
    .matchAll(/^Page\s+(\d+) size:\s+(\S+) x (\S+) pts/gm)) {
    const page = Number(match[1]),
      width = Number(match[2]),
      height = Number(match[3]);
    if (
      page >= 1 &&
      page <= pages &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    )
      sizes[page - 1] = { width, height };
  }
  return sizes;
}

const nonWhitespaceLength = (text: string) => text.replace(/\s/g, "").length;

const ocrReplacesLayer = (ocrCharacters: number, layerCharacters: number) =>
  ocrCharacters >
  (layerCharacters < USABLE_PAGE_TEXT
    ? layerCharacters
    : layerCharacters * OCR_REPLACEMENT_RATIO + OCR_REPLACEMENT_EXTRA);

/** Normal pages render at 300 DPI; larger ones just fit the pixel cap on their longest side. */
export const renderDpi = (width: number, height: number) =>
  Math.min(
    MAX_RENDER_DPI,
    ((MAX_RENDER_SIDE_PX * 72) / Math.max(width, height)) *
      REPORTED_SIZE_MARGIN,
  );

/**
 * Uses each page's text layer, OCRs pages without usable text or sparse text
 * over a page-dominating scan up to `maxOcrPages` or the deadline, and stops
 * early once more than the stored text cap exists. An OCRed page stores one
 * source, because its render already includes any selectable text: the OCR text
 * when `ocrReplacesLayer` holds, otherwise the exact selectable text.
 */
export async function extractPdfText(
  path: string,
  directory: string,
  options: Options,
): Promise<{
  text: string;
  truncated: boolean;
  pageCount: number;
  ocrPageCount: number;
}> {
  const sizes = await pageSizes(path, options.signal);
  const pages: string[] = [];
  let length = 0,
    truncated = false;
  for (let first = 1; first <= sizes.length; first += TEXT_BATCH_PAGES) {
    const last = Math.min(sizes.length, first + TEXT_BATCH_PAGES - 1);
    const result = await runTool(
      "pdftotext",
      [
        "-enc",
        "UTF-8",
        "-eol",
        "unix",
        "-f",
        String(first),
        "-l",
        String(last),
        path,
        "-",
      ],
      { signal: options.signal, maxOutputBytes: 16 * 1024 * 1024 },
    );
    if (result.code !== 0 && !result.truncated) throw failed(result);
    const batch = result.stdout
      .toString("utf8")
      .split("\f")
      .slice(0, last - first + 1);
    while (!result.truncated && batch.length < last - first + 1) batch.push("");
    pages.push(...batch);
    length += batch.reduce((sum, page) => sum + page.length, 0);
    if (result.truncated || length > MAX_TEXT_LENGTH) {
      truncated = true;
      break;
    }
  }
  const characters = pages.map(nonWhitespaceLength);
  const imagePages = new Set<number>();
  // Scanned articles can have selectable headers/footers above the basic text
  // threshold. A large raster image or stencil reveals the unread page body.
  if (
    characters.some(
      (count) => count >= USABLE_PAGE_TEXT && count < SPARSE_PAGE_TEXT,
    )
  ) {
    const images = await runTool(
      "pdfimages",
      ["-f", "1", "-l", String(pages.length), "-list", path],
      { signal: options.signal },
    );
    if (images.code !== 0 && !images.truncated) throw failed(images);
    const listing = images.truncated ? "" : images.stdout.toString("utf8");
    for (const line of listing.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (
        !/^\d+$/.test(fields[0] ?? "") ||
        !["image", "stencil"].includes(fields[2] ?? "")
      )
        continue;
      const index = Number(fields[0]) - 1;
      const size = sizes[index];
      if (!size) continue;
      const width = Number(fields[3]),
        height = Number(fields[4]);
      const xPpi = Number(fields.at(-4)),
        yPpi = Number(fields.at(-3));
      if (
        ![width, height, xPpi, yPpi].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        continue;
      const imageArea = ((width * 72) / xPpi) * ((height * 72) / yPpi);
      if (imageArea >= size.width * size.height * SCAN_IMAGE_COVERAGE)
        imagePages.add(index);
    }
  }
  const needsOcr = (index: number) =>
    characters[index]! < USABLE_PAGE_TEXT ||
    (characters[index]! < SPARSE_PAGE_TEXT && imagePages.has(index));
  let ocrPageCount = 0;
  const totalPages = characters.filter((_, index) => needsOcr(index)).length;
  if (totalPages > 0)
    await options.onProgress?.({ phase: "ocr", completedPages: 0, totalPages });
  for (const [index, page] of pages.entries()) {
    if (!needsOcr(index)) continue;
    if (
      ocrPageCount >= options.maxOcrPages ||
      (options.deadline !== undefined && Date.now() >= options.deadline)
    ) {
      truncated ||=
        ocrPageCount > 0 ||
        characters[index]! < USABLE_PAGE_TEXT ||
        characters.some((_, other) => other > index && needsOcr(other));
      break;
    }
    const size = sizes[index];
    if (!size) throw new ExtractionFailure("page_size_unavailable", false);
    const prefix = join(directory, `page-${index + 1}`);
    const rendered = await runTool(
      "pdftoppm",
      [
        "-f",
        String(index + 1),
        "-l",
        String(index + 1),
        "-r",
        String(renderDpi(size.width, size.height)),
        "-cropbox",
        "-gray",
        "-png",
        "-singlefile",
        path,
        prefix,
      ],
      { signal: options.signal },
    );
    if (rendered.code !== 0)
      throw new ExtractionFailure(
        "render_failed",
        false,
        rendered.stderr.slice(0, 500),
      );
    try {
      const recognized = await ocrImage(
        `${prefix}.png`,
        options.ocrLanguages,
        options.signal,
      );
      pages[index] = ocrReplacesLayer(
        nonWhitespaceLength(recognized),
        characters[index]!,
      )
        ? recognized.trim()
        : page.trim();
    } finally {
      await rm(`${prefix}.png`, { force: true });
    }
    ocrPageCount += 1;
    await options.onProgress?.({
      phase: "ocr",
      completedPages: ocrPageCount,
      totalPages,
    });
  }
  return {
    text: pages.join("\n\n"),
    truncated,
    pageCount: sizes.length,
    ocrPageCount,
  };
}
