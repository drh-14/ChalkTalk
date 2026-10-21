import { renderAttachedImage, type DigestImage } from "./images.js";
import { randomUUID } from "node:crypto";
import { renderEquation } from "./math.js";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, RootContent } from "hast";
import type {
  Root as MarkdownRoot,
  RootContent as MarkdownContent,
} from "mdast";

export type InlineImage = {
  filename: string;
  content: Buffer;
  contentType: "image/png";
  cid: string;
  contentDisposition: "inline";
};
export type DigestEntry = {
  title: string;
  url: string;
  body: string;
  images?: DigestImage[];
};
export type DigestInput = {
  courseName: string;
  activityDate: string;
  courseUrl: string;
  counts: { post: number; answer: number; followup: number };
  items: DigestEntry[];
  totalItems?: number;
};
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(() => (root: MarkdownRoot) => {
    const pending: Array<MarkdownRoot | MarkdownContent> = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "listItem" && typeof node.checked === "boolean") {
        const paragraph = node.children[0];
        if (paragraph?.type === "paragraph") {
          paragraph.children.unshift({
            type: "text",
            value: node.checked ? "[x] " : "[ ] ",
          });
          node.checked = null;
        }
      }
      if ("children" in node) pending.push(...node.children);
    }
  })
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, {
    tagNames: [
      "p",
      "br",
      "strong",
      "b",
      "i",
      "s",
      "sup",
      "sub",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "hr",
    ],
    attributes: {
      a: ["href", "title"],
      code: [["className", "language-math", "math-inline", "math-display"]],
      ol: ["start"],
    },
    protocols: { href: ["http", "https"] },
    strip: [
      "script",
      "style",
      "iframe",
      "svg",
      "math",
      "form",
      "object",
      "embed",
      "img",
    ],
  })
  .use(rehypeStringify);

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
function safeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function orderedStart(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(number) && Math.abs(number) <= 100_000
    ? number
    : undefined;
}
function plain(
  node: Root | RootContent,
  equationSources?: WeakMap<Element, string>,
): string {
  if (node.type === "text") return node.value;
  if (node.type !== "root" && node.type !== "element") return "";
  if (node.type === "element" && equationSources?.has(node))
    return equationSources.get(node)!;
  if (node.type === "element" && ["br", "hr"].includes(node.tagName))
    return "\n";
  if (node.type === "element" && node.tagName === "tr")
    return `\n${node.children.map((child) => plain(child, equationSources)).join(" | ")}\n`;
  if (node.type === "element" && node.tagName === "ol") {
    let index = 0;
    const start = orderedStart(node.properties.start) ?? 1;
    return `\n${node.children
      .map((child) =>
        child.type === "element" && child.tagName === "li"
          ? `${start + index++}. ${plain(child, equationSources).slice(1, -1)}\n`
          : plain(child, equationSources),
      )
      .join("")}\n`;
  }
  const text = node.children
    .map((child) => plain(child, equationSources))
    .join("");
  if (node.type === "element" && node.tagName === "a") {
    const href = String(node.properties.href ?? "");
    return safeUrl(href) ? `${text} (${href})` : text;
  }
  return node.type === "element" &&
    [
      "p",
      "li",
      "pre",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "table",
      "thead",
      "tbody",
    ].includes(node.tagName)
    ? `\n${text}\n`
    : text;
}
function boundAndClean(
  root: Root,
  placeholders?: ReadonlySet<Element>,
): boolean {
  let remaining = 600;
  let nodes = 0;
  let truncated = false;
  function walk(parent: Root | Element, depth = 0): void {
    if (depth >= 64) {
      truncated ||= parent.children.length > 0;
      parent.children = [];
      return;
    }
    const kept: RootContent[] = [];
    for (const node of parent.children) {
      if (++nodes > 10_000) {
        truncated = true;
        break;
      }
      const atLimit = remaining === 0;
      if (node.type === "text") {
        const characters = Array.from(node.value);
        truncated ||= characters.length > remaining;
        node.value = characters.slice(0, remaining).join("");
        remaining -= Math.min(remaining, characters.length);
        if (!atLimit) kept.push(node);
      } else if (node.type === "element") {
        if (atLimit) truncated = true;
        if (node.tagName === "ol") {
          const start = orderedStart(node.properties.start);
          if (start === undefined) delete node.properties.start;
          else node.properties.start = start;
        }
        if (
          node.tagName === "a" &&
          !safeUrl(String(node.properties.href ?? ""))
        )
          delete node.properties.href;
        const classes = node.properties.className;
        const equation =
          node.tagName === "code" &&
          Array.isArray(classes) &&
          classes.includes("language-math");
        if (equation || placeholders?.has(node)) {
          const length = Array.from(
            equation
              ? plain(node)
              : node.children.map((child) => plain(child)).join(""),
          ).length;
          if (length > remaining) {
            truncated = true;
            remaining = 0;
            continue;
          }
          remaining -= length;
        } else walk(node, depth + 1);
        if (!atLimit) kept.push(node);
      }
    }
    parent.children = kept as typeof parent.children;
  }
  walk(root);
  return truncated;
}
function summary(counts: DigestInput["counts"]): string {
  return (["post", "answer", "followup"] as const)
    .map((kind) => `${counts[kind]} ${kind}${counts[kind] === 1 ? "" : "s"}`)
    .join(" · ");
}
export async function renderDigest(
  input: DigestInput,
): Promise<{ html: string; text: string; attachments: InlineImage[] }> {
  const attachments: InlineImage[] = [];
  let imageCount = 0;
  let imageBytes = 0;
  let equationCount = 0;
  let equationBytes = 0;
  const heading = `${input.courseName} activity for ${input.activityDate}`;
  const html = [
    `<!doctype html><html><body><main style="max-width:640px;margin:auto;font-family:Arial,sans-serif;color:#222"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(summary(input.counts))}</p>`,
  ];
  const text = [heading, "", summary(input.counts), ""];
  let rendered = 0;
  for (const item of input.items.slice(0, 50)) {
    const attachmentStart = attachments.length;
    const bodyBytes = Buffer.from(item.body);
    let truncated = bodyBytes.length > 128 * 1024;
    const source = new TextDecoder().decode(bodyBytes.subarray(0, 128 * 1024), {
      stream: truncated,
    });
    let tree: Root;
    try {
      tree = (await processor.run(processor.parse(source))) as Root;
      truncated = boundAndClean(tree) || truncated;
    } catch {
      truncated = true;
      tree = {
        type: "root",
        children: [
          {
            type: "element",
            tagName: "p",
            properties: {},
            children: [{ type: "text", value: "View full content" }],
          },
        ],
      };
    }
    const href = safeUrl(item.url) ? item.url : input.courseUrl;
    const placeholders = new Set<Element>();
    const equationSources = new WeakMap<Element, string>();
    async function equations(parent: Root | Element): Promise<void> {
      for (const node of parent.children) {
        if (node.type !== "element") continue;
        const classes = node.properties.className;
        if (
          node.tagName === "code" &&
          Array.isArray(classes) &&
          classes.includes("language-math")
        ) {
          const source = plain(node);
          equationSources.set(node, source);
          const display = classes.includes("math-display");
          const content =
            equationCount < 20 && equationBytes < 1024 * 1024
              ? await renderEquation(source, display)
              : undefined;
          equationCount++;
          if (content && equationBytes + content.length <= 1024 * 1024) {
            equationBytes += content.length;
            const cid = `equation-${randomUUID()}@chalktalk`;
            attachments.push({
              filename: "equation.png",
              content,
              contentType: "image/png",
              cid,
              contentDisposition: "inline",
            });
            node.tagName = "img";
            node.properties = {
              src: `cid:${cid}`,
              alt: source,
              style: "max-width:100%;height:auto;vertical-align:middle",
            };
            node.children = [];
          } else {
            node.tagName = "a";
            node.properties = { href };
            node.children = [{ type: "text", value: "View equation" }];
            placeholders.add(node);
          }
        } else await equations(node);
      }
    }
    await equations(tree);
    if (placeholders.size) {
      truncated = boundAndClean(tree, placeholders) || truncated;
      const retainedCids = new Set<string>();
      const pending: Array<Root | RootContent> = [tree];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.type === "element") {
          if (
            node.tagName === "img" &&
            typeof node.properties.src === "string" &&
            node.properties.src.startsWith("cid:")
          )
            retainedCids.add(node.properties.src.slice(4));
          pending.push(...node.children);
        } else if (node.type === "root") pending.push(...node.children);
      }
      for (
        let index = attachments.length - 1;
        index >= attachmentStart;
        index--
      ) {
        const attachment = attachments[index]!;
        if (!retainedCids.has(attachment.cid)) {
          equationBytes -= attachment.content.length;
          attachments.splice(index, 1);
        }
      }
    }
    const plainBody = plain(tree, equationSources)
      .replace(/^\n/, "")
      .replace(/\n$/, "");
    const imageHtml: string[] = [];
    const imageText: string[] = [];
    for (const image of item.images ?? []) {
      const content =
        imageCount++ < 5 && imageBytes < 5 * 1024 * 1024
          ? await renderAttachedImage(image)
          : undefined;
      if (content && imageBytes + content.length <= 5 * 1024 * 1024) {
        imageBytes += content.length;
        const cid = `attachment-${randomUUID()}@chalktalk`;
        attachments.push({
          filename: "image.png",
          content,
          contentType: "image/png",
          cid,
          contentDisposition: "inline",
        });
        imageHtml.push(
          `<p style="text-align:center"><img src="cid:${cid}" alt="${escapeHtml(image.filename)}" style="max-width:100%;height:auto"></p>`,
        );
      } else if (safeUrl(image.url)) {
        imageHtml.push(
          `<p><a href="${escapeHtml(image.url)}">View image: ${escapeHtml(image.filename)}</a></p>`,
        );
      }
      imageText.push(`${image.filename}: ${image.url}`);
    }
    const readMore = truncated
      ? `<p><a href="${escapeHtml(href)}">Read more</a></p>`
      : "";
    const entryHtml = `<article style="margin:24px 0;padding-bottom:24px;border-bottom:1px solid #ddd"><h2 style="font-size:20px"><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a></h2>${processor.stringify(tree)}${imageHtml.join("")}${readMore}</article>`;
    if (
      Buffer.byteLength(html.join("")) + Buffer.byteLength(entryHtml) >
      250 * 1024
    ) {
      attachments.splice(attachmentStart);
      break;
    }
    html.push(entryHtml);
    rendered++;
    text.push(item.title, plainBody, ...imageText, href, "");
  }
  if ((input.totalItems ?? input.items.length) > rendered) {
    html.push(
      `<p><a href="${escapeHtml(input.courseUrl)}">View remaining activity</a></p>`,
    );
    text.push(`View remaining activity: ${input.courseUrl}`);
  }
  html.push("</main></body></html>");
  return { html: html.join(""), text: text.join("\n"), attachments };
}
