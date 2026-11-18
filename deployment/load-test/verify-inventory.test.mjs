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
  assert.deepEqual(verifyInventory({ ...safe, jobIds: ["job-1"] }, safe), safe.counts);
});
