import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRampSchedule, mayStartSlot } from "./schedule.mjs";

test("10–30-user profiles ramp gradually and allocate six writer journeys within caps", () => {
  for (const maximum of [10, 20, 30]) {
    const schedule = buildRampSchedule(maximum);
    assert.equal(schedule.actors.length, maximum);
    assert.equal(schedule.writes.length, 60);
    assert.deepEqual(
      schedule.writes.reduce((counts, item) => {
        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
        return counts;
      }, {}),
      {
        question: 6,
        note: 3,
        poll: 3,
        answer: 6,
        followup: 6,
        vote: 6,
        conversation: 6,
        reply: 12,
        watch: 6,
        read: 6,
      },
    );
    assert.deepEqual(
      schedule.actors.slice(0, 3).map((item) => item.courseIndex),
      [0, 1, 2],
    );
    assert.ok(schedule.actors.at(-1).loginSlot > schedule.actors[0].loginSlot);
    const starts = [
      ...schedule.actors.map((actor) => actor.loginSlot),
      ...schedule.writes.map((item) => item.slot),
    ].sort((a, b) => a - b);
    assert.equal(new Set(starts).size, starts.length);
    assert.ok(starts.every((slot, i) => i === 0 || slot - starts[i - 1] >= 1));
    assert.ok(starts.at(-1) < 100);
    for (const item of schedule.writes)
      assert.ok(item.slot > schedule.actors[item.actorIndex].loginSlot);
  }
});

test("at most one second of lateness preserves five seconds between actual starts", () => {
  const origin = 1_000_000;
  assert.equal(mayStartSlot(origin + 12_000, origin, 2), true);
  assert.equal(mayStartSlot(origin + 13_000, origin, 2), true);
  assert.equal(mayStartSlot(origin + 13_001, origin, 2), false);
  assert.equal(mayStartSlot(origin + 11_999, origin, 2), false);
  assert.ok(origin + 18_000 - (origin + 13_000) >= 5_000);
});
