import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyInventory } from "./verify-inventory.mjs";

const safe = {
  counts: { organizations: 1, courses: 1, users: 20, posts: 2, jobs: 1 },
  violations: [],
  jobIds: ["job-1"],
};
test("reviewed fixture inventory requires exact roots and no violations", () => {
  assert.deepEqual(verifyInventory(safe), safe.counts);
  for (const bad of [
    { ...safe, counts: { ...safe.counts, users: 19 } },
    { ...safe, counts: { ...safe.counts, posts: 12 } },
    { ...safe, violations: ["foreign reference"] },
    { ...safe, jobIds: [] },
  ])
    assert.throws(() => verifyInventory(bad));
});

test("cleanup inventory rejects changed counts and job identities", () => {
  for (const changed of [
    { ...safe, counts: { ...safe.counts, posts: 3 } },
    { ...safe, jobIds: ["job-2"] },
  ])
    assert.throws(() => verifyInventory(changed, safe));
  assert.deepEqual(
    verifyInventory({ ...safe, jobIds: ["job-1"] }, safe),
    safe.counts,
  );
});

test("three-course Ramp inventory accepts bounded roots and rejects Thread fan-out excess", () => {
  const ramp = {
    counts: {
      organizations: 1,
      courses: 3,
      users: 30,
      posts: 6,
      jobs: 0,
      thread_boards: 3,
      thread_conversations: 0,
      thread_messages: 0,
      thread_watches: 0,
      thread_message_reads: 0,
      thread_notifications: 0,
      thread_changes: 0,
      thread_course_counters: 0,
      course_resource_catalogs: 3,
      course_resources: 3,
      course_resource_revisions: 3,
    },
    violations: [],
    jobIds: [],
  };
  assert.deepEqual(verifyInventory(ramp), ramp.counts);
  assert.throws(() =>
    verifyInventory({
      ...ramp,
      counts: { ...ramp.counts, thread_notifications: 257 },
    }),
  );
});
