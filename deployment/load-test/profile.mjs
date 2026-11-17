import { createHash } from "node:crypto";

function integer(name, value, min, max) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return parsed;
}

export function normalizeProfile(source) {
  const maxVus = integer("LOAD_TEST_MAX_VUS", source.LOAD_TEST_MAX_VUS, 1, 20);
  const stages = (source.LOAD_TEST_STAGE_MINUTES ?? "").split(",");
  if (stages.length !== 4)
    throw new Error("LOAD_TEST_STAGE_MINUTES needs four stages");
  const stageMinutes = stages.map((value) =>
    integer("stage minutes", value, 1, 10),
  );
  if (stageMinutes.reduce((sum, value) => sum + value, 0) > 10)
    throw new Error("LOAD_TEST_STAGE_MINUTES exceeds ten minutes");
  const rampWriteAttempts = integer(
    "LOAD_TEST_RAMP_WRITE_ATTEMPTS",
    source.LOAD_TEST_RAMP_WRITE_ATTEMPTS,
    6,
    17,
  );
  return {
    maxVus,
    stageMinutes,
    stageTargets: [1, 5, 10, 20].map((target) => Math.min(target, maxVus)),
    rampWriteAttempts,
  };
}

export function fingerprintProfile(profile) {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

export function validateTargetIdentity(storageEndpoint, databaseUrl) {
  let storage;
  let database;
  try {
    storage = new URL(storageEndpoint);
    database = new URL(databaseUrl);
  } catch {
    throw new Error("Supabase target URL is invalid");
  }
  const storageMatch = /^([a-z0-9]{20})(?:\.storage)?\.supabase\.co$/.exec(
    storage.hostname,
  );
  if (
    storage.protocol !== "https:" ||
    !storageMatch ||
    storage.port ||
    storage.pathname !== "/storage/v1/s3" ||
    storage.username ||
    storage.password ||
    storage.search ||
    storage.hash
  )
    throw new Error("Storage endpoint must be an exact Supabase HTTPS S3 URL");
  const projectRef = storageMatch[1];
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !/^[a-z0-9.-]+\.supabase\.com$/.test(database.hostname) ||
    database.username !== `postgres.${projectRef}` ||
    !database.password ||
    database.pathname !== "/postgres" ||
    database.hash ||
    database.searchParams.getAll("sslmode").length !== 1 ||
    database.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error(
      "Database URL does not match same-project verified-TLS Supabase target",
    );
  return { projectRef, databaseHost: database.hostname };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const profile = normalizeProfile(process.env);
    const target = validateTargetIdentity(
      process.env.SUPABASE_STORAGE_ENDPOINT,
      process.env.DATABASE_URL,
    );
    process.stdout.write(
      JSON.stringify({
        profile,
        fingerprint: fingerprintProfile(profile),
        ...target,
      }) + "\n",
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
