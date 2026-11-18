import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deliverReport } from "./email-report.mjs";

const runId = "load-20261117-a1b2c3d4";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "k6-mail-"));
  const directory = join(root, "safe");
  mkdirSync(directory);
  for (const name of [
    "report.html",
    "summary.json",
    "coverage.json",
    "scope.json",
  ])
    writeFileSync(
      join(directory, name),
      name === "report.html"
        ? "<!doctype html><html>safe</html>"
        : JSON.stringify(
            name === "scope.json" ? { runId, mode: "ramp" } : { safe: true },
          ),
    );
  const receipt = join(root, "receipt.json");
  writeFileSync(
    receipt,
    JSON.stringify({
      runId,
      mode: "ramp",
      zeroResidue: true,
      manifestRemoved: true,
      state: "cleaned",
    }),
  );
  return {
    root,
    directory,
    receipt,
    manifest: {
      runId,
      users: [{ email: "vu@example.invalid", password: "secret" }],
    },
  };
}

test("delivers only four individually attached sanitized reports after cleanup receipt", async () => {
  const data = fixture();
  try {
    let payload, headers;
    const fetcher = async (_url, options) => {
      payload = JSON.parse(options.body);
      headers = options.headers;
      return {
        ok: true,
        json: async () => ({ id: "4a5d8797-9036-4440-8888-123456789abc" }),
      };
    };
    const result = await deliverReport(
      data.directory,
      data.receipt,
      data.manifest,
      runId,
      "ramp",
      "re_test",
      "44156607166",
      fetcher,
    );
    assert.equal(result.status, "delivered");
    assert.deepEqual(
      payload.attachments.map((item) => item.filename),
      ["report.html", "summary.json", "coverage.json", "scope.json"],
    );
    assert.equal(payload.to[0], "darrenh1134@gmail.com");
    assert.equal(
      headers["Idempotency-Key"],
      "chalktalk-load-report/44156607166",
    );
    assert.equal(
      payload.attachments[0].content,
      Buffer.from("<!doctype html><html>safe</html>").toString("base64"),
    );
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("refuses uncertain cleanup and symlinked or private attachment before sending", async () => {
  const data = fixture();
  try {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      throw new Error("must not send");
    };
    writeFileSync(
      data.receipt,
      JSON.stringify({ runId, mode: "ramp", zeroResidue: false }),
    );
    await assert.rejects(
      deliverReport(
        data.directory,
        data.receipt,
        data.manifest,
        runId,
        "ramp",
        "re_test",
        "44156607166",
        fetcher,
      ),
      /cleanup/i,
    );
    writeFileSync(
      data.receipt,
      JSON.stringify({
        runId,
        mode: "ramp",
        zeroResidue: true,
        manifestRemoved: true,
        state: "cleaned",
      }),
    );
    rmSync(join(data.directory, "report.html"));
    symlinkSync(
      join(data.directory, "scope.json"),
      join(data.directory, "report.html"),
    );
    await assert.rejects(
      deliverReport(
        data.directory,
        data.receipt,
        data.manifest,
        runId,
        "ramp",
        "re_test",
        "44156607166",
        fetcher,
      ),
      /regular/i,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});
