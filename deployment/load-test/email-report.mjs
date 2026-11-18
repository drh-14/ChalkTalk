/* global process, fetch, AbortSignal */
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertSafeText } from "./coverage.mjs";

const REPORTS = [
  ["report.html", "text/html"],
  ["summary.json", "application/json"],
  ["coverage.json", "application/json"],
  ["scope.json", "application/json"],
];
const RECIPIENT = "darrenh1134@gmail.com";
const SENDER = "ChalkTalk <notifications@joinchalktalk.com>";
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function regularBounded(path, maxBytes) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes)
    throw new Error("Report attachment must be a bounded regular file");
  return readFileSync(path);
}

export async function deliverReport(
  directory,
  receiptPath,
  manifest,
  runId,
  mode,
  apiKey,
  actionsRunId,
  fetcher = fetch,
) {
  if (
    !/^load-[0-9]{8}-[a-z0-9]{8,32}$/.test(runId) ||
    !["smoke", "ramp"].includes(mode) ||
    !/^[0-9]{6,30}$/.test(actionsRunId) ||
    !/^re_[a-zA-Z0-9_-]+$/.test(apiKey ?? "")
  )
    throw new Error("Report delivery identity or credential is invalid");
  const receipt = JSON.parse(
    regularBounded(receiptPath, 4096).toString("utf8"),
  );
  if (
    receipt.runId !== runId ||
    receipt.mode !== mode ||
    receipt.zeroResidue !== true ||
    receipt.manifestRemoved !== true ||
    receipt.state !== "cleaned"
  )
    throw new Error(
      "Verified cleanup receipt is required before report delivery",
    );
  const root = resolve(directory);
  const scope = JSON.parse(
    regularBounded(join(root, "scope.json"), 64 * 1024).toString("utf8"),
  );
  if (scope.runId !== runId || scope.mode !== mode)
    throw new Error("Report scope identity mismatch");
  let total = 0;
  const attachments = REPORTS.map(([filename, contentType]) => {
    const content = regularBounded(join(root, filename), 10 * 1024 * 1024);
    total += content.length;
    if (total > MAX_TOTAL_BYTES)
      throw new Error("Report attachments exceed bounded aggregate size");
    const text = content.toString("utf8");
    assertSafeText(text, manifest);
    if (contentType === "application/json") JSON.parse(text);
    else if (!text.startsWith("<!doctype html>"))
      throw new Error("Custom HTML report is invalid");
    return {
      filename,
      content: content.toString("base64"),
      content_type: contentType,
    };
  });
  const body = {
    from: SENDER,
    to: [RECIPIENT],
    subject: `ChalkTalk ${mode} load test report ${runId}`,
    text: `Sanitized ChalkTalk load-test reports for ${runId}. The GitHub Actions result remains authoritative for traffic and cleanup status.`,
    attachments,
  };
  let response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `chalktalk-load-report/${actionsRunId}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { status: "unknown", category: "transport" };
  }
  if (!response.ok)
    return { status: "failed", category: `provider-http-${response.status}` };
  try {
    const result = await response.json();
    if (!/^[0-9a-f-]{36}$/.test(result.id ?? ""))
      return { status: "unknown", category: "provider-response" };
    return { status: "delivered", messageId: result.id };
  } catch {
    return { status: "unknown", category: "provider-response" };
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [directory, receiptPath, manifestPath, runId, mode] =
    process.argv.slice(2);
  try {
    const manifest = JSON.parse(
      regularBounded(manifestPath, 65536).toString("utf8"),
    );
    const result = await deliverReport(
      directory,
      receiptPath,
      manifest,
      runId,
      mode,
      process.env.RESEND_API_KEY,
      process.env.GITHUB_RUN_ID,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", category: "pre-send-validation" })}\n`,
    );
    process.exitCode = 1;
  }
}
