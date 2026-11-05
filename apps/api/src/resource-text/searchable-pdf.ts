import { stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { pageSizes, renderDpi } from "./pdf.js";
import { ExtractionFailure, runTool } from "./tools.js";
import type { ExtractionOptions } from "./extract.js";
const MAX_PDF_BYTES = 100 * 1024 * 1024;

export async function buildSearchablePdf(
  source: string,
  directory: string,
  options: ExtractionOptions,
) {
  const sizes = await pageSizes(source, options.signal);
  if (!sizes.length || sizes.length > options.maxOcrPages)
    throw new ExtractionFailure("searchable_pdf_page_limit", true);
  const pages: string[] = [];
  let bytes = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (options.signal?.aborted) throw new ExtractionFailure("aborted", false);
    const size = sizes[i];
    if (!size) throw new ExtractionFailure("page_size_unavailable", false);
    const dpi = renderDpi(size.width, size.height);
    const prefix = join(directory, `searchable-${i + 1}`);
    const rendered = await runTool(
      "pdftoppm",
      [
        "-f",
        String(i + 1),
        "-l",
        String(i + 1),
        "-r",
        String(dpi),
        "-cropbox",
        "-png",
        "-singlefile",
        source,
        prefix,
      ],
      { signal: options.signal },
    );
    if (rendered.code !== 0)
      throw new ExtractionFailure("render_failed", false);
    try {
      const ocr = await runTool(
        "tesseract",
        [
          `${prefix}.png`,
          prefix,
          "-l",
          options.ocrLanguages,
          "--psm",
          "3",
          "--dpi",
          String(Math.max(1, Math.floor(dpi))),
          "pdf",
        ],
        { signal: options.signal },
      );
      if (ocr.code !== 0) throw new ExtractionFailure("ocr_failed", false);
    } finally {
      await rm(`${prefix}.png`, { force: true });
    }
    const path = `${prefix}.pdf`;
    bytes += (await stat(path)).size;
    if (bytes > MAX_PDF_BYTES)
      throw new ExtractionFailure("searchable_pdf_size_limit", true);
    pages.push(path);
  }
  const merge = async (inputs: string[], output: string) => {
    const result = await runTool(
      "qpdf",
      [
        "--empty",
        "--pages",
        ...inputs.flatMap((path) => [path, "1-z"]),
        "--",
        output,
      ],
      { signal: options.signal },
    );
    if (result.code !== 0 && result.code !== 3)
      throw new ExtractionFailure("pdf_assembly_failed", false);
    if ((await stat(output)).size > MAX_PDF_BYTES)
      throw new ExtractionFailure("searchable_pdf_size_limit", true);
  };
  const chunks: string[] = [];
  for (let i = 0; i < pages.length; i += 50) {
    const path = join(directory, `searchable-chunk-${i}.pdf`);
    await merge(pages.slice(i, i + 50), path);
    chunks.push(path);
    for (const page of pages.slice(i, i + 50)) await rm(page, { force: true });
  }
  const path = join(directory, "searchable.pdf");
  await merge(chunks, path);
  const count = await runTool("qpdf", ["--show-npages", path], {
    signal: options.signal,
  });
  if (
    (count.code !== 0 && count.code !== 3) ||
    Number(count.stdout.toString().trim()) !== sizes.length
  )
    throw new ExtractionFailure("pdf_page_count_mismatch", false);
  return { path, pageCount: sizes.length, sizeBytes: (await stat(path)).size };
}
