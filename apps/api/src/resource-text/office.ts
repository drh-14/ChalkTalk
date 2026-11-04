import { unzip, type UnzipFileInfo } from "fflate";
import { readFile } from "node:fs/promises";
import { SaxesParser } from "saxes";
import { ExtractionFailure } from "./tools.js";

/** Individual XML parts larger than this are not text-extracted. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

const wordNamespaces = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const drawingNamespaces = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
]);

const partNumber = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1]);

/** Collects text runs from one XML part, with line breaks at paragraphs and explicit breaks. */
function xmlText(xml: Uint8Array, namespaces: Set<string>, text: string) {
  const parser = new SaxesParser({ xmlns: true });
  let output = "",
    inText = 0;
  parser.on("opentag", (tag) => {
    if (!namespaces.has(tag.uri)) return;
    if (tag.local === text) inText += 1;
    else if (tag.local === "tab") output += " ";
    else if (tag.local === "br" || tag.local === "cr") output += "\n";
  });
  parser.on("closetag", (tag) => {
    if (!namespaces.has(tag.uri)) return;
    if (tag.local === text) inText -= 1;
    else if (tag.local === "p") output += "\n";
  });
  parser.on("text", (value) => {
    if (inText > 0) output += value;
  });
  try {
    parser.write(new TextDecoder("utf-8").decode(xml)).close();
  } catch {
    throw new ExtractionFailure("damaged_file", true);
  }
  return output;
}

function unzipParts(
  data: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<{ parts: Record<string, Uint8Array>; truncated: boolean }> {
  let truncated = false;
  return new Promise((resolve, reject) =>
    unzip(
      data,
      {
        filter: (file: UnzipFileInfo) => {
          if (!wanted(file.name)) return false;
          if (file.originalSize <= MAX_PART_BYTES) return true;
          truncated = true;
          return false;
        },
      },
      (error, files) =>
        error
          ? reject(new ExtractionFailure("damaged_file", true, error.message))
          : resolve({ parts: files, truncated }),
    ),
  );
}

/** Extracts DOCX body text, or PPTX slide text followed by speaker notes, in slide-number order. */
export async function extractOfficeText(
  path: string,
  kind: "docx" | "pptx",
): Promise<{ text: string; truncated: boolean }> {
  const data = new Uint8Array(await readFile(path));
  if (kind === "docx") {
    const { parts } = await unzipParts(
      data,
      (name) => name === "word/document.xml",
    );
    const document = parts["word/document.xml"];
    if (!document) throw new ExtractionFailure("damaged_file", true);
    return { text: xmlText(document, wordNamespaces, "t"), truncated: false };
  }
  const { parts, truncated } = await unzipParts(data, (name) =>
    /^ppt\/(?:slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name),
  );
  const ordered = (prefix: string) =>
    Object.keys(parts)
      .filter((name) => name.startsWith(prefix))
      .sort((a, b) => partNumber(a) - partNumber(b));
  return {
    text: [...ordered("ppt/slides/"), ...ordered("ppt/notesSlides/")]
      .map((name) => xmlText(parts[name]!, drawingNamespaces, "t"))
      .join("\n\n"),
    truncated,
  };
}
