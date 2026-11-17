import { readFileSync } from "node:fs";

const reads = [
  "login",
  "list_courses",
  "list_posts",
  "read_post",
  "list_notifications",
  "unread_count",
];
const mutations = [
  "create_question",
  "create_note",
  "create_answer",
  "create_followup",
  "create_poll",
  "vote",
];

export function requiredOperations(mode) {
  if (mode === "smoke") return [...reads, "smoke_vote"];
  if (mode === "ramp") return [...reads, ...mutations];
  throw new Error("Invalid load-test mode");
}

export function verifyCoverage(summary, mode) {
  const required = requiredOperations(mode);
  for (const operation of required) {
    const count = summary.metrics?.[`op_${operation}_success`]?.values?.count;
    if (!Number.isFinite(count) || count < 1)
      throw new Error(`Incomplete selected-flow coverage: ${operation}`);
  }
  return required;
}

export function assertSafeText(text, manifest) {
  const secrets = [
    ...(manifest.users ?? []).flatMap((user) => [user.email, user.password]),
    ...Object.entries(manifest)
      .filter(([key]) => key !== "runId" && /id$/i.test(key))
      .map(([, value]) => value),
  ].filter((value) => typeof value === "string" && value.length >= 4);
  if (
    secrets.some((secret) => text.includes(secret)) ||
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) ||
    /\/[a-z0-9-]*[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(text) ||
    /__Host-chalktalk_session|X-CSRF-Token|Bearer\s+\S+/i.test(text)
  )
    throw new Error("Report contains private fixture data");
}

export function sanitizeReport(content, manifest) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  assertSafeText(text, manifest);
  return JSON.parse(text);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [mode, summaryPath, manifestPath] = process.argv.slice(2);
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const summary = sanitizeReport(readFileSync(summaryPath, "utf8"), manifest);
    const covered = verifyCoverage(summary, mode);
    process.stdout.write(
      JSON.stringify({
        selectedCoreApiOperations: covered,
        allSelectedOperationsPassed: true,
      }) + "\n",
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
