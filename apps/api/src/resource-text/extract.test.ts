import { spawnSync } from "node:child_process";
import { strToU8, zipSync } from "fflate";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractText, type ExtractionOptions } from "./extract.js";
import { extractPdfText } from "./pdf.js";
import { withTempDirectory } from "./tools.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const options: ExtractionOptions = { maxOcrPages: 200, ocrLanguages: "eng" };
const extract = (
  name: string,
  mediaType: string,
  overrides: Partial<ExtractionOptions> = {},
) =>
  withTempDirectory((directory) =>
    extractText(fixture(name), mediaType, directory, {
      ...options,
      ...overrides,
    }),
  );
const extractPdf = (name: string, overrides: Partial<ExtractionOptions> = {}) =>
  withTempDirectory((directory) =>
    extractPdfText(fixture(name), directory, { ...options, ...overrides }),
  );
const available = (command: string, flag: string) =>
  spawnSync(command, [flag]).error === undefined;
const tools =
  available("pdftotext", "-v") &&
  available("pdftoppm", "-v") &&
  available("pdfinfo", "-v") &&
  available("tesseract", "--version");
if (!tools)
  console.warn(
    "Skipping PDF and OCR extraction tests: pdftotext, pdftoppm, pdfinfo and tesseract are required (installed in the dev image and CI).",
  );
const withTools = tools ? describe : describe.skip;
const words = (text: string) => text.toLowerCase();

function officeArchive(parts: Record<string, string>, oversizedPart: string) {
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  );
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const end = archive.length - 22;
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < view.getUint16(end + 10, true); index += 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      archive.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (name === oversizedPart)
      view.setUint32(offset + 24, 64 * 1024 * 1024 + 1, true);
    offset +=
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return archive;
}

const slideXml = (text: string) =>
  `<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${text}</a:t></a:r></a:p>`;
const pptxType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const extractArchive = (data: Uint8Array, mediaType = pptxType) =>
  withTempDirectory(async (directory) => {
    const path = join(directory, "office.zip");
    await writeFile(path, data);
    return extractText(path, mediaType, directory, options);
  });

describe("plain text and Office extraction", () => {
  it("decodes text and Markdown as UTF-8, replacing invalid bytes", async () => {
    const result = await withTempDirectory(async (directory) => {
      const path = join(directory, "notes.md");
      await writeFile(
        path,
        Buffer.concat([
          Buffer.from("# Week 1\r\n\r\n\r\n\r\nMatrices"),
          Buffer.from([0xff]),
          Buffer.from(" ünïcode"),
        ]),
      );
      return extractText(path, "text/markdown", directory, options);
    });
    expect(result).toEqual({
      text: "# Week 1\n\nMatrices� ünïcode",
      truncated: false,
    });
  });

  it("marks oversized plain text truncated", async () => {
    const result = await withTempDirectory(async (directory) => {
      const path = join(directory, "big.txt");
      await writeFile(path, "word ".repeat(500_000));
      return extractText(path, "text/plain", directory, options);
    });
    expect(result.truncated).toBe(true);
    expect([...result.text].length).toBeLessThanOrEqual(500_000);
  });

  it("extracts DOCX body text with tabs and line breaks but not field codes", async () => {
    const result = await extract(
      "notes.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result).toEqual({
      text: "Homework rubric\nLine one\nLine two & more",
      truncated: false,
    });
  });

  it("extracts PPTX slides in numeric order followed by speaker notes", async () => {
    const result = await extract(
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(result).toEqual({
      text: "First slide vectors\n\nSecond slide kernels\n\nTenth slide summary\n\nSpeaker notes mention basis",
      truncated: false,
    });
  });

  it.each(["ppt/slides/slide3.xml", "ppt/notesSlides/notesSlide3.xml"])(
    "marks partial text truncated when %s exceeds the XML-part limit",
    async (oversizedPart) => {
      const archive = officeArchive(
        {
          "ppt/slides/slide10.xml": slideXml("Tenth slide"),
          "ppt/slides/slide2.xml": slideXml("Second slide"),
          "ppt/notesSlides/notesSlide10.xml": slideXml("Tenth note"),
          "ppt/notesSlides/notesSlide2.xml": slideXml("Second note"),
          [oversizedPart]: slideXml("Omitted text"),
        },
        oversizedPart,
      );
      expect(await extractArchive(archive)).toEqual({
        text: "Second slide\n\nTenth slide\n\nSecond note\n\nTenth note",
        truncated: true,
      });
    },
  );

  it("does not mark text truncated for oversized unrelated archive entries", async () => {
    const unrelated = "ppt/theme/theme1.xml";
    expect(
      await extractArchive(
        officeArchive(
          {
            "ppt/slides/slide1.xml": slideXml("Retained slide"),
            "ppt/notesSlides/notesSlide1.xml": slideXml("Retained notes"),
            [unrelated]: "unused",
          },
          unrelated,
        ),
      ),
    ).toEqual({
      text: "Retained slide\n\nRetained notes",
      truncated: false,
    });
  });

  it("marks an empty PPTX result truncated when every wanted part is skipped", async () => {
    const part = "ppt/slides/slide1.xml";
    expect(
      await extractArchive(
        officeArchive({ [part]: slideXml("Omitted") }, part),
      ),
    ).toEqual({ text: "", truncated: true });
  });

  it.each<Record<string, string>>([
    {},
    { "word/document.xml": "oversized body" },
  ])(
    "keeps missing and oversized DOCX bodies permanent damaged-file failures",
    async (parts) => {
      await expect(
        extractArchive(
          officeArchive(parts, "word/document.xml"),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).rejects.toMatchObject({ code: "damaged_file", permanent: true });
    },
  );

  it("keeps malformed DOCX bodies permanent damaged-file failures", async () => {
    await expect(
      extractArchive(
        zipSync({ "word/document.xml": strToU8("<broken>") }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).rejects.toMatchObject({ code: "damaged_file", permanent: true });
  });

  it("rejects media types without an extractor as permanent", async () => {
    await expect(
      extract("notes.docx", "application/zip"),
    ).rejects.toMatchObject({
      code: "unsupported_media_type",
      permanent: true,
    });
  });
});

withTools("PDF and OCR extraction", () => {
  it("uses the text layer without OCR when pages have text", async () => {
    const result = await extract("text.pdf", "application/pdf");
    expect(words(result.text)).toContain("eigenvalues of symmetric matrices");
    expect(words(result.text)).toContain("orthogonal diagonalization");
    expect(result.truncated).toBe(false);
    expect(await extractPdf("text.pdf")).toMatchObject({
      pageCount: 2,
      ocrPageCount: 0,
    });
  });

  it("OCRs image-only pages of a scanned PDF", async () => {
    const result = await extractPdf("scanned.pdf");
    expect(words(result.text)).toContain("gradient descent");
    expect(result).toMatchObject({ pageCount: 1, ocrPageCount: 1 });
  });

  it("combines text-layer and OCR pages in page order", async () => {
    const result = await extractPdf("mixed.pdf");
    const text = words(result.text);
    expect(text).toContain("fourier series");
    expect(text).toContain("laplace transform");
    expect(text.indexOf("fourier")).toBeLessThan(text.indexOf("laplace"));
    expect(result).toMatchObject({ pageCount: 2, ocrPageCount: 1 });
  });

  it("stops OCR at the page cap and marks the text truncated", async () => {
    const result = await extractPdf("capped.pdf", { maxOcrPages: 2 });
    const text = words(result.text);
    expect(text).toContain("gradient descent");
    expect(text).toContain("lagrange");
    expect(text).not.toContain("bayesian");
    expect(result).toMatchObject({
      truncated: true,
      pageCount: 3,
      ocrPageCount: 2,
    });
    expect(await extractPdf("capped.pdf", { maxOcrPages: 0 })).toMatchObject({
      truncated: true,
      ocrPageCount: 0,
    });
    expect(
      (await extract("capped.pdf", "application/pdf", { maxOcrPages: 0 }))
        .truncated,
    ).toBe(true);
  });

  it("stops OCR at an already-passed deadline, keeping earlier pages", async () => {
    const result = await extractPdf("mixed.pdf", {
      deadline: Date.now() - 1,
    });
    const text = words(result.text);
    expect(text).toContain("fourier series");
    expect(text).not.toContain("laplace");
    expect(result).toMatchObject({
      truncated: true,
      pageCount: 2,
      ocrPageCount: 0,
    });
  });

  it("fails encrypted PDFs permanently", async () => {
    await expect(
      extract("encrypted.pdf", "application/pdf"),
    ).rejects.toMatchObject({ code: "encrypted_pdf", permanent: true });
  });

  it("OCRs a JPEG after applying its EXIF rotation", async () => {
    const result = await extract("rotated.jpg", "image/jpeg");
    expect(words(result.text)).toContain("whiteboard");
    expect(words(result.text)).toContain("eigenvectors");
  });

  it("OCRs a WebP image", async () => {
    const result = await extract("photo.webp", "image/webp");
    expect(words(result.text)).toContain("determinant");
  });

  it("fails undecodable images permanently", async () => {
    await expect(
      withTempDirectory(async (directory) => {
        const path = join(directory, "broken.png");
        await writeFile(path, Buffer.from("not an image"));
        return extractText(path, "image/png", directory, options);
      }),
    ).rejects.toMatchObject({ code: "damaged_file", permanent: true });
  });
});
