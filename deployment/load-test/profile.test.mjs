import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeProfile, validateTargetIdentity } from "./profile.mjs";

const variables = {
  LOAD_TEST_MAX_VUS: "20",
  LOAD_TEST_STAGE_MINUTES: "1,3,3,3",
  LOAD_TEST_RAMP_WRITE_ATTEMPTS: "17",
};
const databaseUrl =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

test("normalizes the bounded profile and fingerprints canonical values", () => {
  const profile = normalizeProfile(variables);
  assert.deepEqual(profile, {
    maxVus: 20,
    stageMinutes: [1, 3, 3, 3],
    stageTargets: [1, 5, 10, 20],
    rampWriteAttempts: 17,
  });
  assert.deepEqual(
    normalizeProfile({ ...variables, LOAD_TEST_MAX_VUS: "020" }),
    profile,
  );
});

test("smaller ceilings collapse fixed targets without raising them", () => {
  assert.deepEqual(
    normalizeProfile({
      ...variables,
      LOAD_TEST_MAX_VUS: "4",
      LOAD_TEST_RAMP_WRITE_ATTEMPTS: "6",
    }),
    {
      maxVus: 4,
      stageMinutes: [1, 3, 3, 3],
      stageTargets: [1, 4, 4, 4],
      rampWriteAttempts: 6,
    },
  );
});

test("invalid or missing profile values fail closed", () => {
  for (const [name, values] of [
    ["missing", { ...variables, LOAD_TEST_MAX_VUS: "" }],
    ["over-vus", { ...variables, LOAD_TEST_MAX_VUS: "21" }],
    ["zero-vus", { ...variables, LOAD_TEST_MAX_VUS: "0" }],
    ["bad-stages", { ...variables, LOAD_TEST_STAGE_MINUTES: "1,3,3" }],
    ["zero-stage", { ...variables, LOAD_TEST_STAGE_MINUTES: "1,3,0,3" }],
    ["long-stages", { ...variables, LOAD_TEST_STAGE_MINUTES: "1,4,4,4" }],
    ["bad-writes", { ...variables, LOAD_TEST_RAMP_WRITE_ATTEMPTS: "5" }],
    ["high-writes", { ...variables, LOAD_TEST_RAMP_WRITE_ATTEMPTS: "18" }],
    ["noninteger", { ...variables, LOAD_TEST_MAX_VUS: "2.5" }],
  ])
    assert.throws(() => normalizeProfile(values), undefined, name);
});

test("target identity accepts only same-project Supabase storage and verified database", () => {
  for (const storage of [
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3",
    "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
  ]) {
    assert.deepEqual(validateTargetIdentity(storage, databaseUrl), {
      projectRef: "abcdefghijklmnopqrst",
      databaseHost: "aws-0-us-east-1.pooler.supabase.com",
    });
  }
  for (const [storage, db] of [
    [
      "https://otherprojectref12345.storage.supabase.co/storage/v1/s3",
      databaseUrl,
    ],
    [
      "http://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
      databaseUrl,
    ],
    [
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3?x=1",
      databaseUrl,
    ],
    [
      "https://abcdefghijklmnopqrst.storage.supabase.co.evil.test/storage/v1/s3",
      databaseUrl,
    ],
    [
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
      databaseUrl.replace("verify-full", "disable"),
    ],
    [
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
      databaseUrl.replace(
        "postgres.abcdefghijklmnopqrst",
        "postgres.otherprojectref12345",
      ),
    ],
  ])
    assert.throws(() => validateTargetIdentity(storage, db));
});

test("runner preflight writes a private profile and identity without logging credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "chalktalk-k6-profile-"));
  try {
    const stdout = execFileSync(
      process.execPath,
      [new URL("./prepare-runner.mjs", import.meta.url).pathname, directory],
      {
        env: {
          ...process.env,
          ...variables,
          DATABASE_URL: databaseUrl,
          SUPABASE_STORAGE_ENDPOINT:
            "https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3",
        },
        encoding: "utf8",
      },
    );
    assert.doesNotMatch(stdout, /secret|postgresql:|abcdefghijklmnopqrst/);
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "profile.json"))),
      normalizeProfile(variables),
    );
    assert.deepEqual(
      Object.keys(
        JSON.parse(readFileSync(join(directory, "identity.json"))),
      ).sort(),
      ["projectRef", "databaseHost", "nonce", "mac"].sort(),
    );
    for (const name of ["profile.json", "identity.json"])
      assert.equal(statSync(join(directory, name)).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
