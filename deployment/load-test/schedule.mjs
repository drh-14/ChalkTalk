export const SLOT_MS = 6000;
const MAX_LATE_MS = 1000;
const LOGIN_SLOTS = [
  0, 1, 10, 14, 18, 22, 26, 30, 34, 38, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67,
  70, 73, 76, 79, 82, 85, 88, 91, 94, 97,
];
const POST_KINDS = [
  ["question", "poll"],
  ["question", "poll"],
  ["question", "poll"],
  ["question", "note"],
  ["question", "note"],
  ["question", "note"],
];

export function mayStartSlot(nowMs, originMs, slot) {
  const scheduled = originMs + slot * SLOT_MS;
  return (
    Number.isInteger(slot) &&
    slot >= 0 &&
    nowMs >= scheduled &&
    nowMs <= scheduled + MAX_LATE_MS
  );
}

export function buildRampSchedule(maxVus) {
  if (!Number.isInteger(maxVus) || maxVus < 10 || maxVus > 30)
    throw new Error("Ramp maximum must be 10–30 users");
  const actors = LOGIN_SLOTS.slice(0, maxVus).map((loginSlot, actorIndex) => ({
    actorIndex,
    loginSlot,
    courseIndex: actorIndex % 3,
    role: actorIndex < 3 ? "instructor" : "student",
  }));
  const reserved = new Set(actors.map((actor) => actor.loginSlot));
  const tasks = POST_KINDS.map((posts) => [
    ...posts,
    "answer",
    "followup",
    "vote",
    "conversation",
    "watch",
    "reply",
    "reply",
    "read",
  ]);
  const completed = Array(6).fill(0);
  const lastByActor = Array(6).fill(-100);
  const writes = [];
  let conversations = 0;
  for (let slot = 2; slot < 100 && writes.length < 60; slot++) {
    if (reserved.has(slot)) continue;
    const eligible = Array.from({ length: 6 }, (_, index) => index).filter(
      (actorIndex) => {
        const kind = tasks[actorIndex][completed[actorIndex]];
        return (
          kind &&
          slot > actors[actorIndex].loginSlot &&
          slot - lastByActor[actorIndex] >= 5 &&
          (kind !== "watch" || conversations === 6)
        );
      },
    );
    if (!eligible.length) continue;
    eligible.sort((a, b) => lastByActor[a] - lastByActor[b] || a - b);
    const actorIndex = eligible[0];
    const kind = tasks[actorIndex][completed[actorIndex]++];
    lastByActor[actorIndex] = slot;
    if (kind === "conversation") conversations++;
    writes.push({
      slot,
      actorIndex,
      courseIndex: actors[actorIndex].courseIndex,
      kind,
    });
  }
  if (writes.length !== 60 || completed.some((count) => count !== 10))
    throw new Error("Bounded write schedule does not fit ten minutes");
  return { slotMs: SLOT_MS, maxLateMs: MAX_LATE_MS, actors, writes };
}
