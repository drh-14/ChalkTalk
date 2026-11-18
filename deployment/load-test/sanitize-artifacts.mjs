import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertSafeText, sanitizeReport } from "./coverage.mjs";

export function sanitizeArtifacts(
  manifest,
  rawDirectory,
  destination,
  runId,
  mode,
  sourceWorkflowUrl,
) {
  if (
    !/^load-[0-9]{8}-[a-z0-9]{8,32}$/.test(runId) ||
    !["smoke", "ramp"].includes(mode) ||
    manifest.runId !== runId
  )
    throw new Error("Report identity mismatch");
  if (
    !/^https:\/\/github\.com\/drh-14\/ChalkTalk\/actions\/runs\/[0-9]{6,30}$/.test(
      sourceWorkflowUrl ?? "",
    )
  )
    throw new Error("Source workflow URL is invalid");
  const reportNames = [
    [`${runId}-${mode}-summary.json`, "summary.json", "json"],
    ["report.html", "report.html", "html"],
    [`${runId}-${mode}.html`, "k6-original.html", "html"],
    ["coverage.json", "coverage.json", "json"],
  ];
  const available = reportNames.filter(([name]) =>
    existsSync(join(rawDirectory, name)),
  );
  const windowPath = join(rawDirectory, "window.json");
  if (!available.length && !existsSync(windowPath)) return;
  if (!existsSync(windowPath))
    throw new Error("Workload UTC window is missing");
  const windowInfo = lstatSync(windowPath);
  if (!windowInfo.isFile() || windowInfo.size > 1024)
    throw new Error("Workload UTC window is invalid");
  const window = JSON.parse(readFileSync(windowPath, "utf8"));
  if (
    !window ||
    typeof window !== "object" ||
    JSON.stringify(Object.keys(window).sort()) !==
      JSON.stringify(["end", "start"]) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(window.start ?? "") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(window.end ?? "") ||
    !Number.isFinite(Date.parse(window.start)) ||
    !Number.isFinite(Date.parse(window.end)) ||
    Date.parse(window.end) < Date.parse(window.start)
  )
    throw new Error("Workload UTC window is invalid");
  const target = resolve(destination);
  if (existsSync(target))
    throw new Error("Sanitized artifact destination already exists");
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const [sourceName, outputName, kind] of available) {
      const source = join(rawDirectory, sourceName);
      const info = lstatSync(source);
      if (!info.isFile() || info.size > 10 * 1024 * 1024)
        throw new Error("Report is not a bounded regular file");
      const content = readFileSync(source, "utf8");
      const safe =
        kind === "json"
          ? JSON.stringify(sanitizeReport(content, manifest), null, 2) + "\n"
          : (assertSafeText(content, manifest), content);
      writeFileSync(join(temporary, outputName), safe, {
        mode: 0o600,
        flag: "wx",
      });
    }
    writeFileSync(
      join(temporary, "scope.json"),
      JSON.stringify(
        {
          runId,
          mode,
          sourceWorkflowUrl,
          selectedCoreApiOnly: true,
          excludedFlows: [
            "signup and email workflows",
            "course administration",
            "file upload, download and OCR",
            "collaboration",
            "destructive user actions",
          ],
          workloadWindowUtc: window,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const [
      manifestPath,
      rawDirectory,
      destination,
      runId,
      mode,
      sourceWorkflowUrl,
    ] = process.argv.slice(2);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    sanitizeArtifacts(
      manifest,
      rawDirectory,
      destination,
      runId,
      mode,
      sourceWorkflowUrl,
    );
    process.stdout.write("Report artifacts screened for private data\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
