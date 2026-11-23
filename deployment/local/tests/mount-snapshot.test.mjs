import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mountSnapshot } from "./mount-snapshot.mjs";

// Captured Docker inspect protocol from the CI restart failure; paths anonymized.
const { before, after } = JSON.parse(
  readFileSync(
    new URL("./mount-snapshot-fixture.json", import.meta.url),
    "utf8",
  ),
);
const snapshot = (mounts) => mountSnapshot(JSON.stringify(mounts));

test("restart retains the same mounts even when Docker reorders inspect output", () => {
  assert.deepEqual(snapshot(after), snapshot(before));
  assert.deepEqual(snapshot([...before].reverse()), snapshot(before));
});

test("restart treats Docker Desktop's host_mnt bind alias as the same host path", () => {
  const aliased = structuredClone(before);
  const bind = aliased.find((mount) => mount.Type === "bind");
  bind.Source = `/host_mnt${bind.Source}`;
  assert.deepEqual(snapshot(aliased), snapshot(before));
  bind.Source = "/host_mnt/different/source";
  assert.notDeepEqual(snapshot(aliased), snapshot(before));
});

for (const [field, value] of [
  ["Name", "different-volume"],
  ["Source", "/different/source"],
  ["Destination", "/different/destination"],
  ["Type", "tmpfs"],
  ["Driver", "different-driver"],
  ["Mode", "ro"],
  ["RW", false],
  ["Propagation", "different-propagation"],
]) {
  test(`restart comparison detects a changed mount ${field}`, () => {
    const changed = structuredClone(before);
    changed[0][field] = value;
    assert.notDeepEqual(snapshot(changed), snapshot(before));
  });
}

test("restart comparison detects added or removed mounts", () => {
  assert.notDeepEqual(snapshot(before.slice(1)), snapshot(before));
  assert.notDeepEqual(
    snapshot([...before, { Type: "tmpfs", Destination: "/new" }]),
    snapshot(before),
  );
});
