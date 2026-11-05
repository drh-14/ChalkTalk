import { open } from "node:fs/promises";
import { extractImageText } from "./image.js";
import { MAX_TEXT_LENGTH, normalizeText } from "./normalize.js";
import { extractOfficeText } from "./office.js";
import { extractPdfText } from "./pdf.js";
import type { ExtractedText, RunningTextProgress } from "./store.js";
import { ExtractionFailure } from "./tools.js";

export type ExtractionOptions = {
  maxOcrPages: number;
  ocrLanguages: string;
  signal?: AbortSignal;
  /** Epoch milliseconds after which no further PDF pages are OCR'd. */
  deadline?: number;
  onProgress?: (progress: RunningTextProgress) => Promise<void>;
};

/** UTF-8 uses at most four bytes per code point, so this many bytes always covers the stored cap. */
const MAX_PLAIN_TEXT_BYTES = MAX_TEXT_LENGTH * 4;

async function readPlainText(path: string) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, MAX_PLAIN_TEXT_BYTES));
    await handle.read(buffer, 0, buffer.length, 0);
    return {
      raw: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
      cut: size > buffer.length,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Extracts normalized text from one stored catalog file. `directory` is a
 * private scratch directory owned by the caller.
 */
export async function extractText(
  path: string,
  mediaType: string,
  directory: string,
  options: ExtractionOptions,
): Promise<ExtractedText> {
  let raw: string,
    cut = false;
  switch (mediaType) {
    case "text/plain":
    case "text/markdown":
      ({ raw, cut } = await readPlainText(path));
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ({ text: raw, truncated: cut } = await extractOfficeText(path, "docx"));
      break;
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ({ text: raw, truncated: cut } = await extractOfficeText(path, "pptx"));
      break;
    case "application/pdf": {
      const pdf = await extractPdfText(path, directory, options);
      raw = pdf.text;
      cut = pdf.truncated;
      break;
    }
    case "image/png":
    case "image/jpeg":
    case "image/webp":
      raw = await extractImageText(
        path,
        directory,
        options.ocrLanguages,
        options.signal,
      );
      break;
    default:
      throw new ExtractionFailure("unsupported_media_type", true);
  }
  const normalized = normalizeText(raw);
  return {
    text: normalized.text,
    truncated: normalized.truncated || cut,
  };
}
