import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requiredOperations,
  verifyCoverage,
  sanitizeReport,
} from "./coverage.mjs";

function summary(mode) {
  return {
    metrics: Object.fromEntries(
      requiredOperations(mode).map((name) => [
        `op_${name}_success`,
        { values: { count: 1 } },
      ]),
    ),
  };
}

test("smoke and ramp require every selected operation to succeed", () => {
  assert.deepEqual(
    verifyCoverage(summary("smoke"), "smoke"),
    requiredOperations("smoke"),
  );
  assert.deepEqual(
    verifyCoverage(summary("ramp"), "ramp"),
    requiredOperations("ramp"),
  );
  const missing = summary("ramp");
  delete missing.metrics.op_create_followup_success;
  assert.throws(() => verifyCoverage(missing, "ramp"), /create_followup/);
  const skipped = summary("ramp");
  skipped.metrics.skipped_write_slots = { values: { count: 1 } };
  assert.throws(
    () => verifyCoverage(skipped, "ramp"),
    /Missed reserved write slot/,
  );
  const courseMissing = summary("ramp");
  delete courseMissing.metrics.op_course_3_thread_success;
  assert.throws(() => verifyCoverage(courseMissing, "ramp"), /course_3_thread/);
  assert.throws(() => verifyCoverage(summary("smoke"), "ramp"));
});

test("reports are rejected if secret or dynamic data leaks", () => {
  const manifest = {
    users: [{ email: "vu@example.invalid", password: "private-password" }],
    courseId: "11111111-1111-1111-1111-111111111111",
  };
  assert.deepEqual(
    sanitizeReport(JSON.stringify(summary("smoke")), manifest),
    summary("smoke"),
  );
  for (const unsafe of [
    "private-password",
    "vu@example.invalid",
    manifest.courseId,
    "/api/v1/posts/11111111-1111-1111-1111-111111111111",
  ])
    assert.throws(() => sanitizeReport(`{"leak":"${unsafe}"}`, manifest));
});
