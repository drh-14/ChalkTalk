import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { extractPdfText } from "./pdf.js";
import { withTempDirectory } from "./tools.js";

const rendered = vi.hoisted(
  () => [] as { width: number | undefined; height: number | undefined }[],
);
vi.mock("./image.js", () => ({
  ocrImage: async (path: string) => {
    const { width, height } = await sharp(path, {
      limitInputPixels: false,
    }).metadata();
    rendered.push({ width, height });
    return "";
  },
}));

const poppler = ["pdfinfo", "pdftotext", "pdftoppm"].every(
  (command) => spawnSync(command, ["-v"]).error === undefined,
);
if (!poppler)
  console.warn(
    "Skipping PDF render bound tests: pdfinfo, pdftotext and pdftoppm are required (installed in the dev image and CI).",
  );

/** A valid one-page PDF with no text layer and the given page boxes. */
function blankPdf(media: number, crop = media) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${media} ${media}] /CropBox [0 0 ${crop} ${crop}] /Resources << >> >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
}

const renderSize = (pdf: string) =>
  withTempDirectory(async (directory) => {
    const path = join(directory, "source.pdf");
    await writeFile(path, pdf);
    rendered.length = 0;
    const result = await extractPdfText(path, directory, {
      maxOcrPages: 200,
      ocrLanguages: "eng",
    });
    expect(result.ocrPageCount).toBe(1);
    expect(rendered).toHaveLength(1);
    return rendered[0]!;
  });

describe.skipIf(!poppler)("PDF page rendering bound", () => {
  it("renders a normal page at 300 DPI", async () => {
    expect(await renderSize(blankPdf(792))).toEqual({
      width: 3300,
      height: 3300,
    });
  });

  it("renders the crop box, not a larger media box, at 300 DPI", async () => {
    expect(await renderSize(blankPdf(3000, 100))).toEqual({
      width: 417,
      height: 417,
    });
  });

  it.each([
    ["the spec's oversized page", 14400],
    ["a page whose size pdfinfo rounds down", 14400.04],
    ["a page beyond 1 DPI at the cap", 999999],
    ["a page pdfinfo prints in exponent notation", 1500000],
  ])("keeps %s within 4,000 pixels", async (_label, side) => {
    const { width, height } = await renderSize(blankPdf(side));
    expect(width).toBeLessThanOrEqual(4000);
    expect(height).toBeLessThanOrEqual(4000);
    expect(width).toBeGreaterThan(3900);
  });
});
