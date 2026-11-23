import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { Pool } from "pg";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const url = process.env.TEST_DATABASE_URL;
const endpoint = process.env.TEST_S3_ENDPOINT;
const integration = url && endpoint ? describe : describe.skip;
const name = `local_startup_${process.pid}_${Date.now()}`;
const bucket = `local-startup-${process.pid}-${Date.now()}`;
let admin: Pool;
let pool: Pool;
let connection: string;
let s3: S3Client;
const source = {
  AUTH_TOKEN_SECRET: "synthetic-authentication-secret-with-32-characters",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "mail@example.test",
  RESEND_API_KEY: "synthetic-key",
  S3_ENDPOINT: endpoint,
  S3_BUCKET: bucket,
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
  S3_SECRET_ACCESS_KEY:
    process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
  AWS_EC2_METADATA_DISABLED: "true",
};
const run = (
  phase: string,
  ack = false,
  store = false,
  extra: Record<string, string | undefined> = {},
) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "deployment/local/runtime.ts",
      phase,
      "false",
      String(store),
      String(ack),
    ],
    {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        ...source,
        DATABASE_URL: connection,
        ...extra,
      },
      encoding: "utf8",
      timeout: 90_000,
    },
  );
const catalog = async () =>
  (
    await pool.query(
      "SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY relname",
    )
  ).rows;
integration("local runtime ownership and readiness", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE ${name}`);
    const parsed = new URL(url!);
    parsed.pathname = `/${name}`;
    connection = parsed.href;
    pool = new Pool({ connectionString: connection });
    s3 = new S3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: source.S3_ACCESS_KEY_ID,
        secretAccessKey: source.S3_SECRET_ACCESS_KEY,
      },
    });
  });
  afterAll(async () => {
    try {
      await s3?.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: "retained" }),
      );
      await s3?.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch {
      /* The fixture may not exist after a preceding failure. */
    }
    s3?.destroy();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });
  it("no-ack refuses an absent ledger read-only and reports safe migration identifiers", async () => {
    const before = await catalog();
    const result = run("check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("External ordinary migrations pending:");
    expect(result.stderr).not.toContain(connection);
    expect(await catalog()).toEqual(before);
    expect(run("prepare").status).toBe(1);
    expect(await catalog()).toEqual(before);
  });
  it("unavailable SES source gates all authorized preparation without snapshotting or provider sends", async () => {
    const before = await catalog();
    const result = run("check", true, false, {
      EMAIL_PROVIDER: "ses",
      RESEND_API_KEY: undefined,
      SES_REGION: "us-east-1",
      SES_CREDENTIALS_MODE: "default-chain",
      AWS_SHARED_CREDENTIALS_FILE: "/nonexistent-synthetic-source",
      AWS_CONFIG_FILE: "/nonexistent-synthetic-source",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(connection);
    expect(await catalog()).toEqual(before);
  });
  it("rejects an expired resolved source before provisioning, with a valid future-expiry control", async () => {
    let expired = false;
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          AccessKeyId: "synthetic-key",
          SecretAccessKey: "synthetic-secret",
          Token: "synthetic-session",
          Expiration: new Date(
            Date.now() + (expired ? -60_000 : 600_000),
          ).toISOString(),
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No source fixture port");
    const attempt = () =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "deployment/local/runtime.ts",
            "check",
            "false",
            "true",
            "true",
          ],
          {
            env: {
              PATH: process.env.PATH,
              ...source,
              DATABASE_URL: connection,
              EMAIL_PROVIDER: "ses",
              RESEND_API_KEY: undefined,
              SES_REGION: "us-east-1",
              SES_CREDENTIALS_MODE: "default-chain",
              AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${address.port}/credentials`,
              AWS_CONFIG_FILE: "/nonexistent-explicit-source",
              AWS_SHARED_CREDENTIALS_FILE: "/nonexistent-explicit-source",
            },
            stdio: "ignore",
          },
        );
        child.once("error", reject);
        child.once("close", resolve);
      });
    try {
      const before = await catalog();
      expect(await attempt()).toBe(0);
      expired = true;
      expect(await attempt()).toBe(1);
      expect(requests).toBeGreaterThanOrEqual(2);
      expect(await catalog()).toEqual(before);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
  it("a missing external bucket cannot cause schema preparation or bucket creation even with migration consent", async () => {
    const before = await catalog();
    expect(run("check", true).status).toBe(1);
    expect(await catalog()).toEqual(before);
    await expect(
      s3.send(new HeadBucketCommand({ Bucket: bucket })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });
  it("explicit consent applies ordinary migrations only, retains empty application data and external objects", async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "retained",
        Body: "owned fixture data",
      }),
    );
    expect(run("check", true).status).toBe(0);
    const prepared = run("prepare", true);
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT to_regclass('post_embeddings') AS semantic,to_regclass('semantic_schema_migrations') AS ledger",
        )
      ).rows[0],
    ).toEqual({ semantic: null, ledger: null });
    expect((await pool.query("SELECT count(*) FROM users")).rows[0].count).toBe(
      "0",
    );
    const before = await catalog();
    expect(run("check").status).toBe(0);
    expect(await catalog()).toEqual(before);
    expect(
      await (
        await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "retained" }))
      ).Body!.transformToString(),
    ).toBe("owned fixture data");
  });
  it("external semantic prerequisites are read-only and never implicitly provisioned", async () => {
    const before = await catalog();
    expect(
      run("check", true, false, { EMBEDDING_API_KEY: "synthetic" }).status,
    ).toBe(1);
    expect(await catalog()).toEqual(before);
  });
});
