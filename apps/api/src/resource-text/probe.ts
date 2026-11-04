import { runTool } from "./tools.js";

const versionChecks = [
  ["pdfinfo", "-v"],
  ["pdftotext", "-v"],
  ["pdftoppm", "-v"],
] as const;

/**
 * Lists missing extraction tools and Tesseract languages. An empty list means
 * the extraction lane can run; otherwise jobs should stay pending until the
 * deployment is fixed rather than exhausting their retries.
 */
export async function missingExtractionTools(
  languages: string,
  run: typeof runTool = runTool,
): Promise<string[]> {
  const missing: string[] = [];
  for (const [command, flag] of versionChecks)
    try {
      await run(command, [flag], { timeoutMs: 10_000 });
    } catch {
      missing.push(command);
    }
  try {
    const listed = await run("tesseract", ["--list-langs"], {
      timeoutMs: 10_000,
    });
    const installed = new Set(
      listed.stdout
        .toString("utf8")
        .split(/\r?\n/)
        .map((line) => line.trim()),
    );
    for (const language of languages.split("+"))
      if (!installed.has(language)) missing.push(`tesseract:${language}`);
  } catch {
    missing.push("tesseract");
  }
  return missing;
}
