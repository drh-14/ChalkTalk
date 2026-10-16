import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { spawn } from "node:child_process";
import {
  closeSync,
  createReadStream,
  openSync,
  promises as fs,
  writeSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { SaxesParser } from "saxes";
import sharp from "sharp";
import { AuthError } from "../auth/errors.js";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const invalid = () =>
  new AuthError(
    415,
    "unsupported_media_type",
    "File format or structure is not supported",
  );
const formats: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const forbiddenPdfNames = new Set([
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/EmbeddedFiles",
  "/OpenAction",
  "/AA",
  "/RichMedia",
  "/XFA",
  "/SubmitForm",
  "/ImportData",
  "/GoToR",
  "/URI",
  "/Encrypt",
]);

function pdfNameScanner() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let quoted = false;
  let escaped = false;
  let token = "";
  return (chunk: Buffer, final = false) => {
    const text = decoder.decode(chunk, { stream: !final });
    for (const character of text) {
      if (!quoted) {
        if (character === '"') {
          quoted = true;
          token = '"';
        }
        continue;
      }
      token += character;
      if (token.length > 64 * 1024) throw invalid();
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        quoted = false;
        if (forbiddenPdfNames.has(JSON.parse(token) as string)) throw invalid();
        token = "";
      }
    }
    if (final && quoted) throw invalid();
  };
}

async function qpdf(
  path: string,
  options: string[],
  scan?: ReturnType<typeof pdfNameScanner>,
) {
  const child = spawn("qpdf", [...options, path], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", resolve);
  });
  let output = "";
  let failure: Error | undefined;
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    for await (const chunk of child.stdout) {
      if (scan) scan(chunk as Buffer);
      else {
        output += chunk.toString("utf8");
        if (output.length > 1024) throw invalid();
      }
    }
    scan?.(Buffer.alloc(0), true);
  } catch (error) {
    failure = error as Error;
    child.kill("SIGKILL");
  }
  const code = await closed;
  clearTimeout(timeout);
  if (failure || code !== 0) throw invalid();
  return output.trim();
}

async function pdfFile(path: string) {
  const handle = await fs.open(path, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(8);
    const tail = Buffer.alloc(Math.min(size, 1024));
    await handle.read(head, 0, head.length, 0);
    await handle.read(tail, 0, tail.length, size - tail.length);
    if (
      !head.toString("ascii").startsWith("%PDF-") ||
      !tail.toString("latin1").includes("%%EOF")
    )
      throw invalid();
  } finally {
    await handle.close();
  }
  await qpdf(path, ["--check"]);
  const count = await qpdf(path, ["--show-npages"]);
  if (!/^\d+$/.test(count) || Number(count) < 1) throw invalid();
  await qpdf(
    path,
    ["--json", "--json-key=qpdf", "--json-stream-data=none"],
    pdfNameScanner(),
  );
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const contentTypesNamespace =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const officeRelationshipSuffixes = [
  "officeDocument",
  "extended-properties",
  "custom-properties",
  "styles",
  "numbering",
  "settings",
  "theme",
  "fontTable",
  "webSettings",
  "header",
  "footer",
  "footnotes",
  "endnotes",
  "comments",
  "image",
  "slide",
  "slideLayout",
  "slideMaster",
  "notesSlide",
  "notesMaster",
  "presProps",
  "viewProps",
  "tableStyles",
  "chart",
  "diagramData",
  "diagramLayout",
  "diagramColors",
  "diagramQuickStyle",
];
const relationshipTypes = new Set([
  ...officeRelationshipSuffixes.map(
    (suffix) =>
      `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${suffix}`,
  ),
  ...officeRelationshipSuffixes.map(
    (suffix) =>
      `http://purl.oclc.org/ooxml/officeDocument/relationships/${suffix}`,
  ),
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  "http://purl.oclc.org/ooxml/package/relationships/metadata/core-properties",
]);
function relationshipSource(name: string, entries: Map<string, unknown>) {
  if (name === "_rels/.rels") return "";
  const match = /^(.*\/)_rels\/([^/]+)\.rels$/.exec(name);
  if (!match) throw invalid();
  const directory = match[1]!;
  const source = directory + match[2]!;
  if (!entries.has(source)) throw invalid();
  return directory;
}
async function zipFile(path: string, kind: "docx" | "pptx") {
  const handle = await fs.open(path, "r");
  const entries = new Map<string, { size: number; crc: number }>();
  let archiveEnd = 0;
  try {
    const { size } = await handle.stat();
    const tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    const index = tail.lastIndexOf(Buffer.from("504b0506", "hex"));
    if (index < 0 || index + 22 + tail.readUInt16LE(index + 20) !== tail.length)
      throw invalid();
    const count = tail.readUInt16LE(index + 10);
    const directorySize = tail.readUInt32LE(index + 12);
    const start = tail.readUInt32LE(index + 16);
    if (
      !count ||
      count > 2048 ||
      tail.readUInt16LE(index + 4) !== 0 ||
      tail.readUInt16LE(index + 6) !== 0 ||
      tail.readUInt16LE(index + 8) !== count ||
      start + directorySize !== size - tail.length + index
    )
      throw invalid();
    archiveEnd = start;
    let offset = start;
    let expanded = 0;
    for (let i = 0; i < count; i++) {
      const header = Buffer.alloc(46);
      if (
        (await handle.read(header, 0, 46, offset)).bytesRead !== 46 ||
        header.readUInt32LE(0) !== 0x02014b50
      )
        throw invalid();
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const compressed = header.readUInt32LE(20);
      const uncompressed = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const mode = header.readUInt32LE(38) >>> 16;
      if (
        !nameLength ||
        flags & 9 ||
        ![0, 8].includes(method) ||
        compressed === 0xffffffff ||
        uncompressed === 0xffffffff ||
        compressed > MAX_UPLOAD_BYTES ||
        uncompressed > MAX_UPLOAD_BYTES ||
        (mode & 0xf000) === 0xa000
      )
        throw invalid();
      const nameBytes = Buffer.alloc(nameLength);
      if (
        (await handle.read(nameBytes, 0, nameLength, offset + 46)).bytesRead !==
        nameLength
      )
        throw invalid();
      const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      if (
        entries.has(name) ||
        name.startsWith("/") ||
        name.includes("\\") ||
        name.includes(":") ||
        name.split("/").includes("..") ||
        name.includes("\0") ||
        (name !== "[Content_Types].xml" &&
          !/\.(?:xml|rels|png|jpe?g|webp)$/i.test(name)) ||
        /(?:vbaProject|\.(?:bin|exe|dll|com|bat|cmd|ps1|vbs|js|html|svg|jar|sh)$|embeddings\/|activeX\/|oleObject)/i.test(
          name,
        )
      )
        throw invalid();
      entries.set(name, { size: uncompressed, crc: header.readUInt32LE(16) });
      expanded += uncompressed;
      if (expanded > 200 * 1024 * 1024) throw invalid();
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (
      offset !== start + directorySize ||
      !entries.has("[Content_Types].xml") ||
      !entries.has("_rels/.rels") ||
      !entries.has(
        kind === "docx" ? "word/document.xml" : "ppt/presentation.xml",
      )
    )
      throw invalid();
  } finally {
    await handle.close();
  }
  const seen = new Set<string>();
  const completed = new Set<string>();
  let contentType = false;
  let officeDocument = false;
  const mediaDirectory = await fs.mkdtemp(join(dirname(path), "ooxml-media-"));
  const mediaPaths = new Map<string, string>();
  const openMedia = new Set<number>();
  const unzipper = new Unzip((file) => {
    const expected = entries.get(file.name);
    if (!expected || seen.has(file.name)) throw invalid();
    seen.add(file.name);
    let length = 0;
    let crc = 0xffffffff;
    let markup = "";
    let markupLength = 0;
    let textLength = 0;
    let quote = 0;
    let entityLength = 0;
    let depth = 0;
    const relationshipIds = new Set<string>();
    const isXml = file.name.endsWith(".xml") || file.name.endsWith(".rels");
    const parser = isXml ? new SaxesParser({ xmlns: true }) : undefined;
    const decoder = isXml
      ? new TextDecoder("utf-8", { fatal: true })
      : undefined;
    const base = file.name.endsWith(".rels")
      ? relationshipSource(file.name, entries)
      : undefined;
    const mediaPath = isXml
      ? undefined
      : join(mediaDirectory, String(mediaPaths.size));
    const mediaFd =
      mediaPath === undefined ? undefined : openSync(mediaPath, "wx");
    if (mediaPath !== undefined && mediaFd !== undefined) {
      mediaPaths.set(file.name, mediaPath);
      openMedia.add(mediaFd);
    }
    if (parser) {
      parser.on("closetag", () => {
        depth--;
      });
      parser.on("opentag", (tag) => {
        if (++depth > 1024) throw invalid();
        const element = tag as typeof tag & { local: string; uri: string };
        const attributes = Object.fromEntries(
          Object.entries(tag.attributes).map(([name, value]) => [
            name,
            typeof value === "string" ? value : value.value,
          ]),
        ) as Record<string, string>;
        if (file.name === "[Content_Types].xml") {
          if (depth === 1) {
            if (
              element.local !== "Types" ||
              element.uri !== contentTypesNamespace
            )
              throw invalid();
          } else if (
            depth !== 2 ||
            element.uri !== contentTypesNamespace ||
            !["Default", "Override"].includes(element.local)
          )
            throw invalid();
        }
        if (base !== undefined) {
          if (depth === 1) {
            if (
              element.local !== "Relationships" ||
              element.uri !== packageRelationships
            )
              throw invalid();
          } else if (
            depth !== 2 ||
            element.local !== "Relationship" ||
            element.uri !== packageRelationships
          )
            throw invalid();
          else if (
            Object.keys(attributes).some(
              (name) => !["Id", "Type", "Target", "TargetMode"].includes(name),
            )
          )
            throw invalid();
        }
        if (
          file.name ===
            (kind === "docx" ? "word/document.xml" : "ppt/presentation.xml") &&
          depth === 1
        ) {
          const local = kind === "docx" ? "document" : "presentation";
          const namespace =
            kind === "docx" ? "wordprocessingml" : "presentationml";
          if (
            element.local !== local ||
            ![
              `http://schemas.openxmlformats.org/${namespace}/2006/main`,
              `http://purl.oclc.org/ooxml/${namespace}/main`,
            ].includes(element.uri)
          )
            throw invalid();
        }
        if (
          file.name === "[Content_Types].xml" &&
          depth === 2 &&
          element.local === "Override" &&
          attributes.PartName ===
            (kind === "docx"
              ? "/word/document.xml"
              : "/ppt/presentation.xml") &&
          attributes.ContentType ===
            (kind === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
              : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
        )
          contentType = true;
        if (base !== undefined && depth === 2) {
          const target = attributes.Target;
          const type = attributes.Type;
          const resolved = target
            ? posix.normalize(posix.join(base, target))
            : "";
          if (
            !target ||
            !type ||
            !attributes.Id ||
            relationshipIds.has(attributes.Id) ||
            !relationshipTypes.has(type) ||
            (attributes.TargetMode !== undefined &&
              attributes.TargetMode.toLowerCase() !== "internal") ||
            target.startsWith("/") ||
            /[\\:%?#]/.test(target) ||
            [...target].some((character) => character.charCodeAt(0) <= 31) ||
            resolved === ".." ||
            resolved.startsWith("../") ||
            resolved === "[Content_Types].xml" ||
            resolved.endsWith(".rels") ||
            (type.endsWith("/image") &&
              !/\.(?:png|jpe?g|webp)$/i.test(resolved)) ||
            !entries.has(resolved)
          )
            throw invalid();
          relationshipIds.add(attributes.Id);
          if (
            file.name === "_rels/.rels" &&
            type.endsWith("/officeDocument") &&
            target ===
              (kind === "docx" ? "word/document.xml" : "ppt/presentation.xml")
          ) {
            if (officeDocument) throw invalid();
            officeDocument = true;
          }
        }
        if (
          Object.values(attributes).some((value) =>
            /macroEnabled|vbaProject|activeX/i.test(value),
          )
        )
          throw invalid();
      });
    }
    file.ondata = (error, chunk, final) => {
      if (error) throw invalid();
      length += chunk.length;
      if (length > expected.size) throw invalid();
      for (const byte of chunk) {
        crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
      }
      if (mediaFd !== undefined) writeSync(mediaFd, chunk);
      if (parser) {
        for (const byte of chunk) {
          if (markupLength) {
            markupLength++;
            if (markupLength > 64 * 1024) throw invalid();
            if (quote) {
              if (byte === quote) quote = 0;
            } else if (byte === 34 || byte === 39) quote = byte;
            else if (byte === 62) markupLength = 0;
          } else if (byte === 60) {
            markupLength = 1;
            textLength = 0;
          } else if (++textLength > 64 * 1024) throw invalid();
          if (!markupLength) {
            if (byte === 38) entityLength = 1;
            else if (entityLength && byte === 59) entityLength = 0;
            else if (entityLength && ++entityLength > 1024) throw invalid();
          }
        }
        const text = decoder!.decode(chunk, { stream: !final });
        if (/<!DOCTYPE|<!ENTITY|<!--|<!\[CDATA\[/i.test(markup + text))
          throw invalid();
        markup = (markup + text).slice(-32);
        parser.write(text);
        if (final) parser.close();
      }
      if (final) {
        if (
          length !== expected.size ||
          (crc ^ 0xffffffff) >>> 0 !== expected.crc
        )
          throw invalid();
        if (mediaFd !== undefined) {
          closeSync(mediaFd);
          openMedia.delete(mediaFd);
        }
        completed.add(file.name);
      }
    };
    file.start();
  });
  unzipper.register(UnzipInflate);
  unzipper.register(UnzipPassThrough);
  try {
    for await (const chunk of createReadStream(path, {
      end: archiveEnd - 1,
      highWaterMark: 4096,
    }))
      unzipper.push(chunk);
    unzipper.push(new Uint8Array(), true);
    if (completed.size !== entries.size || !contentType || !officeDocument)
      throw invalid();
    for (const [name, mediaPath] of mediaPaths) {
      const image = sharp(mediaPath, {
        failOn: "error",
        limitInputPixels: 50_000_000,
      });
      const metadata = await image.metadata();
      const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
      const expectedFormat =
        extension === ".jpg" || extension === ".jpeg"
          ? "jpeg"
          : extension.slice(1);
      if (
        metadata.format !== expectedFormat ||
        !metadata.width ||
        !metadata.height
      )
        throw invalid();
      await image.stats();
    }
  } catch {
    throw invalid();
  } finally {
    for (const fd of openMedia) closeSync(fd);
    await fs.rm(mediaDirectory, { recursive: true, force: true });
  }
}
export async function validateUpload(
  name: string,
  declaredType: string,
  path: string,
): Promise<string> {
  const { size } = await fs.stat(path);
  if (!size || size > MAX_UPLOAD_BYTES)
    throw new AuthError(413, "payload_too_large", "Upload exceeds 100 MiB");
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  const mediaType = formats[extension];
  if (!mediaType || declaredType.toLowerCase() !== mediaType) throw invalid();
  if (extension === ".txt" || extension === ".md") {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let previous = "";
    try {
      for await (const chunk of createReadStream(path)) {
        const text = previous + decoder.decode(chunk, { stream: true });
        if (text.includes("\0") || /<\s*\/?\s*[a-z]/i.test(text))
          throw invalid();
        previous = text.slice(-16);
      }
      decoder.decode();
    } catch {
      throw invalid();
    }
    return mediaType;
  }
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    try {
      const image = sharp(path, {
        failOn: "error",
        limitInputPixels: 50_000_000,
      });
      const metadata = await image.metadata();
      const expected =
        extension === ".jpg" || extension === ".jpeg"
          ? "jpeg"
          : extension.slice(1);
      if (metadata.format !== expected || !metadata.width || !metadata.height)
        throw invalid();
      await image.stats();
    } catch {
      throw invalid();
    }
    return mediaType;
  }
  if (extension === ".docx" || extension === ".pptx") {
    try {
      await zipFile(path, extension.slice(1) as "docx" | "pptx");
    } catch {
      throw invalid();
    }
    return mediaType;
  }
  try {
    await pdfFile(path);
  } catch {
    throw invalid();
  }
  return mediaType;
}
