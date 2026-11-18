import { lstat, open, readFile, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import {
  acquireFixtureClient,
  inventoryFixture,
  provisionFixture,
  teardownFixture,
  validateManifest,
  validateProductionTarget,
  validateRunId,
  type FixtureManifest,
} from "./load-test-fixture.js";

const usage = `Privileged production fixture command (run on the VM only):
  node apps/api/dist/database/load-test-fixture-cli.js provision|inventory|teardown \\
    --confirm-production joinchalktalk.com --expected-project-ref <20-char-ref> \\
    --expected-host <Supabase pooler host> --run-id load-YYYYMMDD-<nonce> \\
    --deployed-sha <full-40-char-SHA> --deployed-sha-file <VM-deployed.sha> \\
    --db-url-file <0600-path> --manifest <0600-path>
  teardown additionally requires --confirm-delete <run-id>.
The database URL is read only from --db-url-file; DATABASE_URL is never used.`;

async function readOwnerOnly(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error(`${path} must be a regular owner-only file (0600)`);
  return (await readFile(path, "utf8")).trim();
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!["provision", "inventory", "teardown"].includes(action))
    throw new Error(usage);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      "confirm-production": { type: "string" },
      "expected-project-ref": { type: "string" },
      "expected-host": { type: "string" },
      "run-id": { type: "string" },
      "deployed-sha": { type: "string" },
      "deployed-sha-file": { type: "string" },
      "db-url-file": { type: "string" },
      manifest: { type: "string" },
      "confirm-delete": { type: "string" },
    },
  });
  if (values["confirm-production"] !== "joinchalktalk.com")
    throw new Error("Explicit production acknowledgement required");
  const runId = values["run-id"];
  const sha = values["deployed-sha"];
  const expectedRef = values["expected-project-ref"];
  const expectedHost = values["expected-host"];
  const dbFile = values["db-url-file"];
  const deployedShaFile = values["deployed-sha-file"];
  const manifestPath = values.manifest;
  if (
    !runId ||
    !sha ||
    !expectedRef ||
    !expectedHost ||
    !dbFile ||
    !deployedShaFile ||
    !manifestPath
  )
    throw new Error(usage);
  validateRunId(runId);
  if ((await readFile(deployedShaFile, "utf8")).trim() !== sha)
    throw new Error("Deployed SHA does not match the VM release record");
  const connectionString = await readOwnerOnly(dbFile);
  validateProductionTarget(connectionString, expectedRef, expectedHost);
  if (action === "teardown" && values["confirm-delete"] !== runId)
    throw new Error("Teardown requires matching --confirm-delete run ID");

  // Never fall back to the app's generic DATABASE_URL; this CLI requires its own explicit file.
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    if (action === "provision") {
      const file = await open(manifestPath, "wx", 0o600);
      let written = false;
      try {
        const manifest = await provisionFixture(
          pool,
          runId,
          sha,
          expectedRef,
          expectedHost,
          async (data) => {
            await file.writeFile(`${JSON.stringify(data, null, 2)}\n`);
            await file.sync();
            written = true;
          },
        );
        process.stdout.write(
          `Provisioned ${manifest.users.length} synthetic users for ${runId}; manifest is ${manifestPath}\n`,
        );
      } catch (error) {
        if (!written) await unlink(manifestPath);
        throw error;
      } finally {
        await file.close();
      }
      return;
    }
    const manifest = JSON.parse(
      await readOwnerOnly(manifestPath),
    ) as FixtureManifest;
    validateManifest(manifest, runId, sha);
    if (
      manifest.expectedHost !== expectedHost ||
      manifest.expectedProjectRef !== expectedRef
    )
      throw new Error("Manifest project identity mismatch");
    if (action === "inventory") {
      const client = await acquireFixtureClient(pool);
      try {
        process.stdout.write(
          `${JSON.stringify(await inventoryFixture(client, manifest), null, 2)}\n`,
        );
      } finally {
        client.release();
      }
    } else {
      const deleted = await teardownFixture(pool, manifest);
      await unlink(manifestPath);
      process.stdout.write(
        `${JSON.stringify({ runId, deleted, residue: 0, manifestRemoved: true }, null, 2)}\n`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // URL and credential values must never be logged.
  process.stderr.write(
    `Fixture command refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
