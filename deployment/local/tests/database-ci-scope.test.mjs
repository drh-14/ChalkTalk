import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parsers } from "prettier/plugins/yaml";

// Consume the workflow as a YAML semantic model, not as source substrings.
function model(node) {
  if (node.type === "mapping")
    return Object.fromEntries(
      node.children.map((item) => item.children.map(model)),
    );
  if (node.type === "sequence") return node.children.map(model);
  if ("value" in node) return node.value;
  return node.children?.length === 1 ? model(node.children[0]) : undefined;
}
const tree = parsers.yaml.parse(
  readFileSync(".github/workflows/ci.yml", "utf8"),
);
const workflow = model(
  tree.children[0].children.find((n) => n.type === "documentBody"),
);
const job = workflow.jobs.verify;
const keys = [
  "TEST_S3_ENDPOINT",
  "TEST_S3_ACCESS_KEY_ID",
  "TEST_S3_SECRET_ACCESS_KEY",
];
const step = (name) => job.steps.find((entry) => entry.name === name);
function effective(entry) {
  const result = spawnSync("/bin/sh", ["-c", "env"], {
    env: { ...workflow.env, ...job.env, ...entry.env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}
test("database fixture environment reaches only explicitly scoped validation steps", () => {
  const validation = effective(
    step("Validate every applicable database suite without skips"),
  );
  const fixture = effective(
    step("Start isolated S3 fixture for database tests"),
  );
  for (const key of keys) {
    assert.ok(validation[key], `${key} missing from database validation`);
    assert.equal(fixture[key], validation[key]);
    for (const entry of job.steps.filter(
      (s) =>
        ![
          "Validate every applicable database suite without skips",
          "Start isolated S3 fixture for database tests",
        ].includes(s.name),
    ))
      assert.equal(
        effective(entry)[key],
        undefined,
        `${entry.name} unexpectedly enables S3 suites`,
      );
  }
});
