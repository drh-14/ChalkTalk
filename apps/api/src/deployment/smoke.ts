import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createEmailSender } from "../auth/email.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../config/environment.js";
import { getMigrationDirectory } from "../database/migrate.js";
import { createPool } from "../database/pool.js";

const RECIPIENT = "chalktalk602@gmail.com";
const CONTENT = Buffer.from("chalktalk-deployment-smoke");

/** External operations are ports so failure and cleanup semantics are testable. */
export interface SmokePorts {
  expectedMigrations(): Promise<string[]>;
  appliedMigrations(): Promise<string[]>;
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  send(to: string, body: string, idempotencyKey: string): Promise<void>;
}

export async function runSmoke(sha: string, ports: SmokePorts): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Invalid commit SHA");
  const [expected, applied] = await Promise.all([
    ports.expectedMigrations(),
    ports.appliedMigrations(),
  ]);
  if (
    expected.length === 0 ||
    expected.length !== applied.length ||
    expected.some((name, index) => name !== applied[index])
  )
    throw new Error(
      "Production migration ledger differs from packaged migrations",
    );

  const key = `deployment-smoke/${sha}/${randomUUID()}.txt`;
  let putAttempted = false;
  try {
    putAttempted = true;
    await ports.put(key, CONTENT);
    const actual = await ports.get(key);
    if (!actual.equals(CONTENT))
      throw new Error("Storage smoke content mismatch");
  } finally {
    if (putAttempted) await ports.remove(key);
  }
  await ports.send(
    RECIPIENT,
    `ChalkTalk deployment smoke for ${sha}. No action is required.`,
    `chalktalk-deploy-${sha}`,
  );
}

async function main(): Promise<void> {
  const sha = process.argv[2] ?? "";
  const environment = loadEnvironment();
  if (!environment.production || environment.email.provider !== "resend")
    throw new Error("Production Resend configuration is required");
  const storage = loadObjectStorageConfig();
  const client = new S3Client(storage.client);
  const pool = createPool(requireDatabaseUrl(environment));
  const sender = createEmailSender(environment);
  try {
    await runSmoke(sha, {
      expectedMigrations: async () =>
        (await readdir(getMigrationDirectory()))
          .filter((name) => name.endsWith(".sql"))
          .sort(),
      appliedMigrations: async () =>
        (
          await pool.query<{ name: string }>(
            "SELECT name FROM schema_migrations ORDER BY name",
          )
        ).rows.map((row) => row.name),
      put: async (key, content) => {
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: content,
            ContentType: "text/plain",
          }),
        );
      },
      get: async (key) => {
        const response = await client.send(
          new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
        );
        if (!response.Body) throw new Error("Storage smoke object has no body");
        return Buffer.from(await response.Body.transformToByteArray());
      },
      remove: async (key) => {
        await client.send(
          new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }),
        );
      },
      send: async (to, text, idempotencyKey) => {
        await sender.send(
          { to, subject: "ChalkTalk deployment smoke", text },
          { idempotencyKey },
        );
      },
    });
    process.stdout.write("Production provider smoke accepted\n");
  } finally {
    await pool.end();
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
