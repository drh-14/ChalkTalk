// Regenerates the committed extraction fixtures. Requires pdftoppm and qpdf:
//   docker compose run --rm --no-deps --entrypoint sh worker -c \
//     "node apps/api/src/resource-text/fixtures/generate.mjs"
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const out = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "fixtures-"));

async function textPdf(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = document.addPage([612, 792]);
    page.drawText(text, { x: 54, y: 680, size: 26, font });
  }
  return Buffer.from(await document.save());
}

/** Renders text to a grayscale PNG the way a scanner would, with no text layer. */
async function scan(text) {
  const source = join(scratch, "source.pdf"),
    prefix = join(scratch, "scan");
  writeFileSync(source, await textPdf([text]));
  execFileSync("pdftoppm", [
    "-r",
    "200",
    "-gray",
    "-png",
    "-singlefile",
    source,
    prefix,
  ]);
  return readFileSync(`${prefix}.png`);
}

async function imagePdf(images) {
  const document = await PDFDocument.create();
  for (const png of images) {
    const image = await document.embedPng(png);
    const page = document.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return Buffer.from(await document.save());
}

async function mixedPdf(text, png) {
  const document = await PDFDocument.load(await textPdf([text]));
  const image = await document.embedPng(png);
  document
    .addPage([612, 792])
    .drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await document.save());
}

const write = (name, bytes) => writeFileSync(join(out, name), bytes);

write(
  "text.pdf",
  await textPdf([
    "Eigenvalues of symmetric matrices are real",
    "Orthogonal diagonalization theorem",
  ]),
);
const scans = [
  await scan("Gradient descent converges slowly"),
  await scan("Lagrange multipliers optimize"),
  await scan("Bayesian posterior distribution"),
];
write("scanned.pdf", await imagePdf([scans[0]]));
write(
  "mixed.pdf",
  await mixedPdf(
    "Fourier series coefficients",
    await scan("Laplace transform table"),
  ),
);
write("capped.pdf", await imagePdf(scans));
execFileSync("qpdf", [
  "--encrypt",
  "user-secret",
  "owner-secret",
  "256",
  "--",
  join(out, "text.pdf"),
  join(out, "encrypted.pdf"),
]);

const photo = await scan("Whiteboard eigenvectors photo");
// Stored rotated 90 degrees counterclockwise; EXIF orientation 6 tells readers to turn it upright.
write(
  "rotated.jpg",
  await sharp(photo)
    .rotate(270)
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer(),
);
write(
  "photo.webp",
  await sharp(await scan("Webp handout determinant"))
    .webp({ quality: 90 })
    .toBuffer(),
);

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
write(
  "notes.docx",
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Homework</w:t><w:tab/><w:t>rubric</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Line one</w:t><w:br/><w:t>Line two &amp; more</w:t></w:r></w:p><w:p><w:r><w:instrText>HYPERLINK hidden</w:instrText></w:r></w:p></w:body></w:document>`,
    ),
  }),
);

const a = "http://schemas.openxmlformats.org/drawingml/2006/main",
  p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const slide = (text) =>
  strToU8(
    `<?xml version="1.0"?><p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
const notes = (text) =>
  strToU8(
    `<?xml version="1.0"?><p:notes xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  );
write(
  "slides.pptx",
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    ),
    "ppt/presentation.xml": strToU8(
      `<?xml version="1.0"?><p:presentation xmlns:p="${p}"/>`,
    ),
    "ppt/slides/slide10.xml": slide("Tenth slide summary"),
    "ppt/slides/slide2.xml": slide("Second slide kernels"),
    "ppt/slides/slide1.xml": slide("First slide vectors"),
    "ppt/notesSlides/notesSlide1.xml": notes("Speaker notes mention basis"),
  }),
);

rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`fixtures written to ${out}
`);
