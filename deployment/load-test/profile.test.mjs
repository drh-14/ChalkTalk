import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeProfile, validateTargetIdentity } from "./profile.mjs";
import { buildRampSchedule } from "./schedule.mjs";

const variables = {
  MODE: "ramp",
  MAX_CONCURRENT_USERS: "30",
};
const databaseUrl =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

test("normalizes the bounded profile and fingerprints canonical values", () => {
  const profile = normalizeProfile(variables);
  assert.deepEqual(profile, {
    maxVus: 30,
    stageMinutes: [1, 3, 3, 3],
    stageTargets: [2, 10, 20, 30],
    rampWriteAttempts: 60,
  });
  assert.equal(
    profile.rampWriteAttempts,
    buildRampSchedule(profile.maxVus).writes.length,
  );
  assert.deepEqual(
    normalizeProfile({ ...variables, MAX_CONCURRENT_USERS: "030" }),
    profile,
  );
  assert.deepEqual(
    normalizeProfile({ ...variables, MAX_CONCURRENT_USERS: "30.0" }),
    profile,
  );
});

test("smaller valid ceilings collapse fixed targets without raising them", () => {
  assert.deepEqual(
    normalizeProfile({
      ...variables,
      MAX_CONCURRENT_USERS: "10",
    }),
    {
      maxVus: 10,
      stageMinutes: [1, 3, 3, 3],
      stageTargets: [2, 10, 10, 10],
      rampWriteAttempts: 60,
    },
  );
  assert.equal(
    normalizeProfile({ ...variables, MAX_CONCURRENT_USERS: "10.0" }).maxVus,
    10,
  );
  assert.equal(
    normalizeProfile({ ...variables, MAX_CONCURRENT_USERS: "15.0" }).maxVus,
    15,
  );
});

test("invalid or missing profile values fail closed", () => {
  for (const [name, values] of [
    ["missing", { ...variables, MAX_CONCURRENT_USERS: "" }],
    ["over-vus", { ...variables, MAX_CONCURRENT_USERS: "31" }],
    ["one-vu", { ...variables, MAX_CONCURRENT_USERS: "1" }],
    ["below-min", { ...variables, MAX_CONCURRENT_USERS: "9" }],
    ["noninteger", { ...variables, MAX_CONCURRENT_USERS: "2.5" }],
    ["over-decimal", { ...variables, MAX_CONCURRENT_USERS: "31.0" }],
    ["missing-fraction", { ...variables, MAX_CONCURRENT_USERS: "15." }],
    ["exponent", { ...variables, MAX_CONCURRENT_USERS: "1e1" }],
    ["whitespace", { ...variables, MAX_CONCURRENT_USERS: " 10.0" }],
  ])
    assert.throws(() => normalizeProfile(values), undefined, name);
});

test("smoke profile is fixed and rejects a ramp input", () => {
  assert.deepEqual(normalizeProfile({ MODE: "smoke" }), {
    maxVus: 1,
    stageMinutes: [1, 3, 3, 3],
    stageTargets: [1, 1, 1, 1],
    rampWriteAttempts: 17,
  });
  assert.throws(() =>
    normalizeProfile({ MODE: "smoke", MAX_CONCURRENT_USERS: "10" }),
  );
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
