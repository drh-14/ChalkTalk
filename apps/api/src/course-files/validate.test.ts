import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateUpload } from "./validate.js";

const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const contentTypesNamespace =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const embeddedPng = await sharp(Buffer.from([255, 0, 0]), {
  raw: { width: 1, height: 1, channels: 3 },
})
  .png()
  .toBuffer();

async function validateStaged(
  name: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-validate-"));
  const path = join(directory, name);
  try {
    await fs.writeFile(path, bytes);
    return await validateUpload(name, mediaType, path);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe("resource format validation", () => {
  it("validates a staged text file from its path", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-validate-"));
    const path = join(directory, "notes.txt");
    try {
      await fs.writeFile(path, "Lecture notes");
      expect(await validateUpload("notes.txt", "text/plain", path)).toBe(
        "text/plain",
      );
      await fs.writeFile(path, Buffer.from([0xff]));
      await expect(
        validateUpload("notes.txt", "text/plain", path),
      ).rejects.toMatchObject({ status: 415 });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("validates a staged Office package from its path", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-validate-"));
    const path = join(directory, "lecture.docx");
    const bytes = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(
          `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
        "_rels/.rels": strToU8(
          `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        ),
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>Hello</w:body></w:document>',
        ),
      }),
    );
    try {
      await fs.writeFile(path, bytes);
      expect(
        await validateUpload(
          "lecture.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path,
        ),
      ).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects an Office package with an external relationship", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-validate-"));
    const path = join(directory, "lecture.docx");
    try {
      await fs.writeFile(
        path,
        zipSync({
          "[Content_Types].xml": strToU8(
            `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
          ),
          "_rels/.rels": strToU8(
            `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.edu/tracker"/></Relationships>`,
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
          ),
        }),
      );
      await expect(
        validateUpload(
          "lecture.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path,
        ),
      ).rejects.toMatchObject({ status: 415 });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("accepts an Office package with an existing nested relationship target", async () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8(
        `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      ),
      "word/_rels/document.xml.rels": strToU8(
        `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>`,
      ),
      "word/media/picture.png": embeddedPng,
    });
    await expect(
      validateStaged(
        "lecture.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes,
      ),
    ).resolves.toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
  it.each([
    ["_rels/.rels", 'Target="word/missing.xml"'],
    ["_rels/.rels", 'Target="../outside.xml"'],
    ["word/_rels/document.xml.rels", 'Target="missing.xml"'],
    ["word/_rels/document.xml.rels", 'Target="../../outside.xml"'],
    [
      "word/_rels/document.xml.rels",
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"',
    ],
  ])(
    "rejects an unsafe %s relationship (%s)",
    async (relationshipFile, replacement) => {
      const root = `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
      const nested = `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>`;
      const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": strToU8(
          `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
        "_rels/.rels": strToU8(
          relationshipFile === "_rels/.rels"
            ? root.replace(
                "</Relationships>",
                `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ${replacement}/></Relationships>`,
              )
            : root,
        ),
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ),
        "word/_rels/document.xml.rels": strToU8(
          relationshipFile !== "_rels/.rels"
            ? nested.replace(
                /(?:Target="media\/picture.png"|Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/image")/,
                replacement,
              )
            : nested,
        ),
        "word/media/picture.png": embeddedPng,
      };
      await expect(
        validateStaged(
          "lecture.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          zipSync(files),
        ),
      ).rejects.toMatchObject({ status: 415 });
    },
  );
  it("rejects executable parts even when related", async () => {
    await expect(
      validateStaged(
        "lecture.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        zipSync({
          "[Content_Types].xml": strToU8(
            `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
          ),
          "_rels/.rels": strToU8(
            `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
          ),
          "word/_rels/document.xml.rels": strToU8(
            `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/payload.py"/></Relationships>`,
          ),
          "word/media/payload.py": strToU8("print('unsafe')"),
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it.each(["_rels/.rels", "word/_rels/document.xml.rels"])(
    "rejects a malformed %s document and a disguised relationship type",
    async (relationshipFile) => {
      const root = `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
      const nested = `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>`;
      const files = {
        "[Content_Types].xml": strToU8(
          `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
        "_rels/.rels": strToU8(root),
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ),
        "word/_rels/document.xml.rels": strToU8(nested),
        "word/media/picture.png": embeddedPng,
      };
      const original = relationshipFile === "_rels/.rels" ? root : nested;
      for (const changed of [
        original
          .replace("<Relationships", "<Foo")
          .replace("</Relationships>", "</Foo>"),
        original
          .replace("/relationships/image", "/relationships/hyperlink/image")
          .replace(
            "/relationships/officeDocument",
            "/relationships/hyperlink/officeDocument",
          ),
      ]) {
        const unsafe = { ...files, [relationshipFile]: strToU8(changed) };
        await expect(
          validateStaged(
            "lecture.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            zipSync(unsafe),
          ),
        ).rejects.toMatchObject({ status: 415 });
      }
    },
  );
  it.each([
    ["picture.png", Buffer.from("print('unsafe')")],
    ["picture.jpg", embeddedPng],
    ["picture.gif", embeddedPng],
  ])(
    "rejects disguised or unsupported embedded media %s",
    async (name, bytes) => {
      await expect(
        validateStaged(
          "lecture.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          zipSync({
            "[Content_Types].xml": strToU8(
              `<Types xmlns="${contentTypesNamespace}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
            ),
            "_rels/.rels": strToU8(
              `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
            ),
            "word/document.xml": strToU8(
              '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
            ),
            "word/_rels/document.xml.rels": strToU8(
              `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/></Relationships>`,
            ),
            [`word/media/${name}`]: bytes,
          }),
        ),
      ).rejects.toMatchObject({ status: 415 });
    },
  );
  it("rejects active markup in Markdown", async () => {
    await expect(
      validateStaged(
        "notes.md",
        "text/markdown",
        Buffer.from("# Notes\n<script>alert(1)</script>"),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it.each([
    ["word/document.xml", "cdata"],
    ["ppt/presentation.xml", "cdata"],
    ["_rels/.rels", "comment"],
    ["word/_rels/document.xml.rels", "comment"],
  ])("bounds %s %s content", async (part, section) => {
    const main = part.startsWith("ppt/")
      ? "ppt/presentation.xml"
      : "word/document.xml";
    const kind = main.startsWith("ppt/") ? "pptx" : "docx";
    const mediaType =
      kind === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const contentType = `${mediaType}.main+xml`;
    const root = `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`;
    const xml =
      kind === "docx"
        ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
        : '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>';
    const payload =
      section === "cdata"
        ? `<![CDATA[>${"x".repeat(128 * 1024)}]]>`
        : `<!-- >${"x".repeat(128 * 1024)} -->`;
    const files: Record<string, Uint8Array> = {
      "[Content_Types].xml": strToU8(
        `<Types xmlns="${contentTypesNamespace}"><Override PartName="/${main}" ContentType="${contentType}"/></Types>`,
      ),
      "_rels/.rels": strToU8(root),
      [main]: strToU8(xml),
    };
    if (part === main)
      files[main] = strToU8(
        xml.replace(
          "/>",
          `>${payload}</${kind === "docx" ? "w:document" : "p:presentation"}>`,
        ),
      );
    else if (part === "_rels/.rels")
      files[part] = strToU8(
        root.replace("<Relationship", `${payload}<Relationship`),
      );
    else
      files[part] = strToU8(
        `<Relationships xmlns="${packageRelationships}">${payload}</Relationships>`,
      );
    await expect(
      validateStaged(`lecture.${kind}`, mediaType, zipSync(files)),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("accepts decoded JPEG and WebP and strict UTF-8 text formats", async () => {
    const pixels = Buffer.from([255, 0, 0]);
    const jpeg = await sharp(pixels, {
      raw: { width: 1, height: 1, channels: 3 },
    })
      .jpeg()
      .toBuffer();
    const webp = await sharp(pixels, {
      raw: { width: 1, height: 1, channels: 3 },
    })
      .webp()
      .toBuffer();
    expect(await validateStaged("photo.jpg", "image/jpeg", jpeg)).toBe(
      "image/jpeg",
    );
    expect(await validateStaged("photo.webp", "image/webp", webp)).toBe(
      "image/webp",
    );
    expect(
      await validateStaged("notes.txt", "text/plain", Buffer.from("Hello")),
    ).toBe("text/plain");
    expect(
      await validateStaged("notes.md", "text/markdown", Buffer.from("# Hello")),
    ).toBe("text/markdown");
  });
  it("accepts real PDF structure and rejects a forged PDF header and trailer", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    expect(
      await validateStaged(
        "lecture.pdf",
        "application/pdf",
        Buffer.from(await pdf.save()),
      ),
    ).toBe("application/pdf");
    await expect(
      validateStaged(
        "forged.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.7\nmalicious bytes\n%%EOF"),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("rejects invalid text encoding and active PDF content", async () => {
    await expect(
      validateStaged("notes.txt", "text/plain", Buffer.from([0xff, 0xfe])),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      validateStaged(
        "active.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4\n/JavaScript\n%%EOF"),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("rejects a PDF action hidden in a compressed object stream", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    pdf.catalog.set(
      PDFName.of("OpenAction"),
      pdf.context.obj({
        S: PDFName.of("JavaScript"),
        JS: PDFString.of('app.alert("unsafe")'),
      }),
    );
    await expect(
      validateStaged(
        "active.pdf",
        "application/pdf",
        Buffer.from(await pdf.save({ useObjectStreams: true })),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
});
