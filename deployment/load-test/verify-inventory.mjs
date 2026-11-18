import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export function verifyInventory(inventory, baseline) {
  const counts = inventory?.counts;
  const ramp = counts?.courses === 3;
  const caps = ramp
    ? {
        posts: 18,
        answers: 6,
        followups: 6,
        poll_votes: 6,
        thread_boards: 3,
        thread_conversations: 6,
        thread_messages: 18,
        thread_watches: 18,
        thread_message_reads: 60,
        thread_notifications: 256,
        thread_changes: 64,
        thread_course_counters: 3,
        course_resource_catalogs: 3,
        course_resources: 3,
        course_resource_revisions: 3,
      }
    : { posts: 11 };
  if (
    !counts ||
    !Array.isArray(inventory.violations) ||
    inventory.violations.length ||
    counts.organizations !== 1 ||
    ![1, 3].includes(counts.courses) ||
    counts.users !== (ramp ? 30 : 20) ||
    !Number.isInteger(counts.posts) ||
    counts.posts < (ramp ? 6 : 2) ||
    Object.entries(caps).some(
      ([name, cap]) =>
        !Number.isInteger(counts[name] ?? 0) || (counts[name] ?? 0) > cap,
    )
  )
    throw new Error(
      "Fixture inventory is incomplete or unsafe; manual review required",
    );
  if (
    !Array.isArray(inventory.jobIds) ||
    inventory.jobIds.length !== counts.jobs ||
    inventory.jobIds.some((id) => typeof id !== "string") ||
    (baseline && !isDeepStrictEqual(inventory, baseline))
  )
    throw new Error(
      "Fixture inventory changed or lacks job identities; manual review required",
    );
  return counts;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    verifyInventory(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
      process.argv[3]
        ? JSON.parse(readFileSync(process.argv[3], "utf8"))
        : undefined,
    );
    process.stdout.write(
      "Reviewed fixture roots and dependencies are within bounds\n",
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
