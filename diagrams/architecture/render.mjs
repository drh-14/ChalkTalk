#!/usr/bin/env node
/** Render the editable Mermaid source to the architecture SVG and PNG. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

  if (format === "svg") {
    const svg = readFileSync(output, "utf8");
    const labeled = svg.replace(
      /<svg\b([^>]*)>/,
      '<svg$1 aria-labelledby="architecture-title architecture-description"><title id="architecture-title">ChalkTalk deployment architecture</title><desc id="architecture-description">A browser connects to services on an OVHcloud VM. The services use Supabase PostgreSQL and object storage, and the API and worker connect to the Resend API over HTTPS.</desc>',
    );
    if (labeled === svg) throw new Error("Mermaid did not produce an SVG root");
    writeFileSync(output, labeled);
  }
}
