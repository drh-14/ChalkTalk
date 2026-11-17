import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sanitizeArtifacts } from "./sanitize-artifacts.mjs";

const runId = "load-20261117-a1b2c3d4";
const sourceSmokeUrl =
  "https://github.com/drh-14/ChalkTalk/actions/runs/44156607166";
const manifest = {
  runId,
  users: [{ email: "vu@example.invalid", password: "private-password" }],
  courseId: "11111111-1111-1111-1111-111111111111",
};

test("only expected sanitized report files become artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "k6-sanitize-"));
  try {
    const raw = join(root, "raw"),
      dest = join(root, "dest");
    mkdirSync(raw);
    writeFileSync(
      join(raw, `${runId}-smoke-summary.json`),
      JSON.stringify({
        metrics: { op_login_success: { values: { count: 1 } } },
      }),
    );
    writeFileSync(
      join(raw, `${runId}-smoke.html`),
      "<html><body>k6 report</body></html>",
    );
    writeFileSync(
      join(raw, "coverage.json"),
      JSON.stringify({ allSelectedOperationsPassed: true }),
    );
    writeFileSync(
      join(raw, "window.json"),
      JSON.stringify({
        start: "2026-11-17T15:00:00Z",
        end: "2026-11-17T15:01:00Z",
      }),
    );
    sanitizeArtifacts(manifest, raw, dest, runId, "smoke", sourceSmokeUrl);
    assert.ok(existsSync(join(dest, "summary.json")));
    assert.ok(existsSync(join(dest, "report.html")));
    assert.ok(existsSync(join(dest, "coverage.json")));
    assert.deepEqual(JSON.parse(readFileSync(join(dest, "scope.json"))), {
      runId,
      mode: "smoke",
      sourceSmokeUrl,
      selectedCoreApiOnly: true,
      excludedFlows: ["course creation", "files", "email", "collaboration"],
      workloadWindowUtc: {
        start: "2026-11-17T15:00:00Z",
        end: "2026-11-17T15:01:00Z",
      },
    });
    assert.equal(
      readFileSync(join(dest, "report.html"), "utf8"),
      "<html><body>k6 report</body></html>",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed workload can publish a window-only scope but refuses invalid chronology", () => {
  const root = mkdtempSync(join(tmpdir(), "k6-sanitize-"));
  try {
    const raw = join(root, "raw"),
      dest = join(root, "dest");
    mkdirSync(raw);
    writeFileSync(
      join(raw, "window.json"),
      JSON.stringify({
        start: "2026-11-17T15:00:00Z",
        end: "2026-11-17T15:01:00Z",
      }),
    );
    sanitizeArtifacts(manifest, raw, dest, runId, "ramp", sourceSmokeUrl);
    assert.ok(existsSync(join(dest, "scope.json")));
    const other = join(root, "other");
    writeFileSync(
      join(raw, "window.json"),
      JSON.stringify({
        start: "2026-11-17T15:02:00Z",
        end: "2026-11-17T15:01:00Z",
      }),
    );
    assert.throws(
      () =>
        sanitizeArtifacts(manifest, raw, other, runId, "ramp", sourceSmokeUrl),
      /window/i,
    );
    assert.equal(existsSync(other), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret leakage leaves no downloadable partial artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "k6-sanitize-"));
  try {
    const raw = join(root, "raw"),
      dest = join(root, "dest");
    mkdirSync(raw);
    writeFileSync(
      join(raw, `${runId}-smoke-summary.json`),
      JSON.stringify({ metrics: {} }),
    );
    writeFileSync(
      join(raw, `${runId}-smoke.html`),
      `<html>${manifest.users[0].password}</html>`,
    );
    assert.throws(() =>
      sanitizeArtifacts(manifest, raw, dest, runId, "smoke", sourceSmokeUrl),
    );
    assert.equal(existsSync(dest), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untrusted source Smoke URLs cannot enter a sanitized artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "k6-sanitize-"));
  try {
    const raw = join(root, "raw"),
      dest = join(root, "dest");
    mkdirSync(raw);
    writeFileSync(
      join(raw, "window.json"),
      JSON.stringify({
        start: "2026-11-17T15:00:00Z",
        end: "2026-11-17T15:01:00Z",
      }),
    );
    assert.throws(
      () =>
        sanitizeArtifacts(
          manifest,
          raw,
          dest,
          runId,
          "smoke",
          "https://example.invalid/actions/runs/44156607166",
        ),
      /Smoke.*URL/i,
    );
    assert.equal(existsSync(dest), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
