#!/usr/bin/env node
/** Render the editable Mermaid source to the architecture SVG and PNG. */
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const source = fileURLToPath(new URL("./architecture.mmd", import.meta.url));

for (const [format, scale] of [
  ["svg", "1"],
  ["png", "2"],
]) {
  const output = fileURLToPath(
    new URL(`./architecture.${format}`, import.meta.url),
  );
  execFileSync(
    "mmdc",
    ["-i", source, "-o", output, "-b", "white", "-s", scale],
    { stdio: "inherit" },
  );
}
