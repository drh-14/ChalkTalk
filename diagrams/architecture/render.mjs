#!/usr/bin/env node
/** Render the editable architecture SVG to its matching PNG preview. */
import { execFileSync } from "node:child_process";
import console from "node:console";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const svgUrl = new URL("./architecture.svg", import.meta.url);
const pngPath = fileURLToPath(new URL("./architecture.png", import.meta.url));
const svg = readFileSync(svgUrl, "utf8");
const dimensions = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
if (!dimensions)
  throw new Error("Architecture SVG needs explicit width and height.");

// Mermaid CLI already supplies Puppeteer for diagram rendering; no extra dependency is needed.
const mmdcPath = realpathSync(
  execFileSync("which", ["mmdc"], { encoding: "utf8" }).trim(),
);
const puppeteer = createRequire(mmdcPath)("puppeteer");
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    deviceScaleFactor: 1,
  });
  await page.goto(svgUrl.href);
  await page.screenshot({ path: pngPath });
  console.log(`Rendered ${pngPath}`);
} finally {
  await browser.close();
}
