import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ocrImage } from "./image.js";
import { MAX_TEXT_LENGTH } from "./normalize.js";
import { ExtractionFailure, runTool, type ToolResult } from "./tools.js";

/** A page with fewer non-whitespace characters than this is treated as scanned. */
export const USABLE_PAGE_TEXT = 20;
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
async function pageSizes(path: string, signal?: AbortSignal) {
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

/** Normal pages render at 300 DPI; larger ones just fit the pixel cap on their longest side. */
const renderDpi = (width: number, height: number) =>
  Math.min(
    MAX_RENDER_DPI,
    ((MAX_RENDER_SIDE_PX * 72) / Math.max(width, height)) *
      REPORTED_SIZE_MARGIN,
  );

/**
 * Uses each page's text layer, OCRs pages without usable text up to
 * `maxOcrPages` or the deadline, and stops early once more than the stored
 * text cap exists.
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
  let ocrPageCount = 0;
  for (const [index, page] of pages.entries()) {
    if (page.replace(/\s/g, "").length >= USABLE_PAGE_TEXT) continue;
    if (
      ocrPageCount >= options.maxOcrPages ||
      (options.deadline !== undefined && Date.now() >= options.deadline)
    ) {
      truncated = true;
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
      pages[index] = [page.trim(), recognized.trim()]
        .filter(Boolean)
        .join("\n");
    } finally {
      await rm(`${prefix}.png`, { force: true });
    }
    ocrPageCount += 1;
  }
  return {
    text: pages.join("\n\n"),
    truncated,
    pageCount: sizes.length,
    ocrPageCount,
  };
}
