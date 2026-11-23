import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const result = JSON.parse(readFileSync(process.argv[2], "utf8"));
const directory = resolve("apps/api/src/database");
const expected = readdirSync(directory)
  .filter(
    (file) =>
      file.endsWith(".test.ts") &&
      file !== "load-test-fixture.integration.test.ts",
  )
  .map((file) => resolve(directory, file));
const actual = result.testResults.map((file) => resolve(file.name));

assert.deepEqual(
  actual.sort(),
  expected.sort(),
  "Database suite selection changed",
);
assert.ok(result.numTotalTests > 0, "No database tests ran");
assert.equal(result.numFailedTests, 0, "Database tests failed");
assert.equal(result.numPendingTests, 0, "Database tests were skipped");
assert.equal(result.numPassedTests, result.numTotalTests);
for (const file of result.testResults) {
  assert.equal(file.status, "passed", `${basename(file.name)} did not pass`);
  assert.ok(
    file.assertionResults.length > 0,
    `${basename(file.name)} has no tests`,
  );
  for (const test of file.assertionResults)
    assert.equal(
      test.status,
      "passed",
      `${basename(file.name)}: ${test.fullName}`,
    );
}

console.log(
  `Validated ${actual.length} database files and ${result.numPassedTests} tests without skips`,
);
