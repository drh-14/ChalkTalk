/** Container-only local startup phases. No provider sends, destructive cleanup, or seeds. */
import { S3Client } from "@aws-sdk/client-s3";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../../apps/api/src/config/environment.js";
import { createPool } from "../../apps/api/src/database/pool.js";
import {
  getMigrationDirectory,
  pendingMigrations,
  runMigrations,
} from "../../apps/api/src/database/migrate.js";
import {
  runTrackedSemanticMigration,
  verifySemanticCompatibility,
} from "../../apps/api/src/database/migrate-semantic.js";
import { ensureStorageBucket } from "../../apps/api/src/course-files/bucket.js";
import { readEmbeddingConfig } from "../../apps/api/src/semantic/provider.js";

class PendingMigrationsError extends Error {
  constructor(names: readonly string[]) {
    super(
      `External ordinary migrations pending: ${names.join(", ")}; use invocation-only --ack-external-migrations after review`,
    );
  }
}

async function main() {
  const [phase, database, store, ack] = process.argv.slice(2);
  if (
    !["check", "prepare"].includes(phase) ||
    ![database, store, ack].every(
      (value) => value === "true" || value === "false",
    )
  )
    throw new Error("Invalid container startup phase");
  const environment = loadEnvironment();
  const storage = loadObjectStorageConfig();
  const pool = createPool(requireDatabaseUrl(environment));
  const s3 = new S3Client({
    ...storage.client,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
  });
  const timeout =
    phase === "check"
      ? setTimeout(() => {
          console.error(
            "Local runtime check timed out; traffic/workers remain gated",
          );
          process.exit(1);
        }, 60_000)
      : undefined;
  try {
    if (phase === "check") {
      // Check credentials first, before any schema or bucket provisioning.
      if (environment.email.provider === "ses") {
        const config = environment.email;
        const ses = new SESv2Client({
          region: config.region,
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          ...(config.credentialsMode === "explicit"
            ? { credentials: config.credentials }
            : {}),
        });
        try {
          const credentials = await ses.config.credentials();
          if (
            credentials.expiration &&
            (!Number.isFinite(credentials.expiration.getTime()) ||
              credentials.expiration.getTime() <= Date.now())
          )
            throw new Error(
              "SES credential source is expired; renew the explicit source",
            );
        } finally {
          ses.destroy();
        }
      }
      await pool.query("SELECT 1");
      const pending = await pendingMigrations(pool, getMigrationDirectory());
      if (database === "false" && ack !== "true" && pending.length)
        throw new PendingMigrationsError(pending);
      if (database === "false" && readEmbeddingConfig())
        await verifySemanticCompatibility(pool);
      // A bundled bucket may be missing here, but no creation is authorized until
      // every read-only prerequisite passes. Head it through the same signed client.
      if (store === "false")
        await ensureStorageBucket(s3, storage.bucket, false);
      else {
        const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
        try {
          await s3.send(new HeadBucketCommand({ Bucket: storage.bucket }));
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("$metadata" in error) ||
            (error.$metadata as { httpStatusCode?: number }).httpStatusCode !==
              404
          )
            throw new Error("Bundled storage is inaccessible");
        }
      }
    } else {
      if (database === "true" || ack === "true")
        await runMigrations(pool, getMigrationDirectory());
      else if ((await pendingMigrations(pool, getMigrationDirectory())).length)
        throw new Error("External database is incompatible");
      if (database === "true") await runTrackedSemanticMigration(pool);
      await ensureStorageBucket(s3, storage.bucket, store === "true");
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    s3.destroy();
    await pool.end();
  }
}
main().catch((error) => {
  // Only our own migration names are safe to report, never SDK/DB causes.
  if (error instanceof PendingMigrationsError) console.error(error.message);
  else
    console.error(
      "Local runtime readiness failed; inspect database/schema, bucket access, and SES credential-source prerequisites",
    );
  process.exitCode = 1;
});
