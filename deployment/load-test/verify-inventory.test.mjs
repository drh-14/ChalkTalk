import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyInventory } from "./verify-inventory.mjs";

const safe = {
  counts: { organizations: 1, courses: 1, users: 20, posts: 2 },
  violations: [],
};
test("reviewed fixture inventory requires exact roots and no violations", () => {
  assert.deepEqual(verifyInventory(safe), safe.counts);
  for (const bad of [
    { ...safe, counts: { ...safe.counts, users: 19 } },
    { ...safe, counts: { ...safe.counts, posts: 12 } },
    { ...safe, violations: ["foreign reference"] },
  ])
    assert.throws(() => verifyInventory(bad));
});
