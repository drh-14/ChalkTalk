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
const courseActivity = [
  "list_threads",
  "thread_unread_count",
  "list_conversations",
  "read_conversation",
  "list_thread_messages",
  "thread_catchup",
  "resource_list",
  "resource_search",
  "create_thread_conversation",
  "create_thread_reply",
  "thread_watch",
  "thread_read",
  "thread_socket_subscribed",
  "thread_socket_changed",
  "thread_socket_closed",
  ...[1, 2, 3].flatMap((index) => [
    `course_${index}_post`,
    `course_${index}_thread`,
  ]),
];

export function requiredOperations(mode) {
  if (mode === "smoke") return [...reads, "smoke_vote"];
  if (mode === "ramp") return [...reads, ...mutations, ...courseActivity];
  throw new Error("Invalid load-test mode");
}

export function verifyCoverage(summary, mode) {
  const required = requiredOperations(mode);
  if (
    mode === "ramp" &&
    (summary.metrics?.skipped_write_slots?.values?.count ?? 0) > 0
  )
    throw new Error(
      "Missed reserved write slot: selected-flow coverage is incomplete",
    );
  for (const operation of required) {
    const count = summary.metrics?.[`op_${operation}_success`]?.values?.count;
    if (!Number.isFinite(count) || count < 1)
      throw new Error(`Incomplete selected-flow coverage: ${operation}`);
  }
  return required;
}

export function assertSafeText(text, manifest) {
  const secrets = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        key !== "runId" &&
        /(^id$|id$|password|email)/i.test(key) &&
        typeof child === "string" &&
        child.length >= 4
      )
        secrets.push(child);
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(manifest);
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
