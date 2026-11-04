import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { ExtractionFailure, runTool } from "./tools.js";

/** Images are downscaled to fit this square before OCR (about 36 megapixels). */
const MAX_OCR_SIDE_PX = 6000;

/** Runs Tesseract on one prepared image file and returns its raw text. */
export async function ocrImage(
  path: string,
  languages: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await runTool(
    "tesseract",
    [path, "stdout", "-l", languages, "--psm", "3"],
    { signal, maxOutputBytes: 4 * 1024 * 1024 },
  );
  if (result.code !== 0 && !result.truncated)
    throw new ExtractionFailure(
      "ocr_failed",
      false,
      result.stderr.slice(0, 500),
    );
  return result.stdout.toString("utf8");
}

/**
 * Normalizes a PNG, JPEG or WebP upload (EXIF rotation, grayscale, bounded
 * size, PNG output) so Tesseract never decodes the original bytes, then OCRs it.
 * Only a failure to decode the upload is permanent.
 */
export async function extractImageText(
  path: string,
  directory: string,
  languages: string,
  signal?: AbortSignal,
): Promise<string> {
  let image: Buffer;
  try {
    image = await sharp(path, { failOn: "error" })
      .rotate()
      .grayscale()
      .resize({
        width: MAX_OCR_SIDE_PX,
        height: MAX_OCR_SIDE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (error) {
    throw new ExtractionFailure(
      "damaged_file",
      true,
      error instanceof Error ? error.message : undefined,
    );
  }
  const prepared = join(directory, "image.png");
  await writeFile(prepared, image);
  return ocrImage(prepared, languages, signal);
}
