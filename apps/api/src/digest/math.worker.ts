import { parentPort, workerData } from "node:worker_threads";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import sharp from "sharp";

try {
  const { source, display } = workerData as {
    source: string;
    display: boolean;
  };
  if (Buffer.byteLength(source) > 2048) throw new Error("Equation too large");
  // Font modules are bundled dependencies, never a URL or a TeX-selected package.
  mathjax.asyncLoad = async (file: string) => {
    if (
      !/^@mathjax\/mathjax-newcm-font\/js\/svg\/dynamic\/[a-z0-9-]+\.js$/.test(
        file,
      )
    )
      throw new Error("Unsupported font module");
    return import(file);
  };
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams"],
      maxBuffer: 5120,
      formatError: () => {
        throw new Error("Invalid equation");
      },
    }),
    OutputJax: new SVG({ fontCache: "none", linebreaks: { inline: false } }),
  });
  const result = await document.convertPromise(source, {
    display,
    em: 18,
    ex: 9,
    containerWidth: 1200,
  });
  const svgNode = adaptor.firstChild(result) as LiteElement;
  const dimensions = String(adaptor.getAttribute(svgNode, "viewBox"))
    .split(/\s+/)
    .map(Number);
  if (
    dimensions.length !== 4 ||
    dimensions.some((n) => !Number.isFinite(n)) ||
    dimensions[2] <= 0 ||
    dimensions[3] <= 0
  )
    throw new Error("Invalid equation geometry");
  adaptor.setAttribute(svgNode, "width", `${(dimensions[2] * 18) / 1000}px`);
  adaptor.setAttribute(svgNode, "height", `${(dimensions[3] * 18) / 1000}px`);
  const svg = adaptor.outerHTML(svgNode);
  // Only paths produced by the restricted local renderer reach the rasterizer.
  const png = await sharp(Buffer.from(svg), {
    density: 144,
    limitInputPixels: 12_000_000,
  })
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  if (png.length > 200 * 1024) throw new Error("Equation image too large");
  parentPort!.postMessage(png);
} catch {
  parentPort!.postMessage(null);
}
