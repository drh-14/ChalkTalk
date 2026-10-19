import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("daily log indices use their event date for lifecycle age", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("./elasticsearch-template.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(template.index_patterns, ["chalktalk-logs-*"]);
  assert.equal(
    template.template.settings["index.lifecycle.name"],
    "chalktalk-local-7d",
  );
  assert.equal(
    template.template.settings["index.lifecycle.parse_origination_date"],
    true,
  );
});
