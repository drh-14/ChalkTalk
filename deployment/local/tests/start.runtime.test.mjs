import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { mountSnapshot } from "./mount-snapshot.mjs";

// Own every resource in this suite. Never use the operator's chalktalk project.
const root = resolve(".");
const prefix = `ct-modular-${process.pid}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
const launch = (envFile, project, ack = false) =>
  new Promise((resolve) => {
    const child = spawn(
      "/bin/sh",
      [
        "deployment/local/start.sh",
        "--env-file",
        envFile,
        "--project-name",
        project,
        ...(ack ? ["--ack-external-migrations"] : []),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          COMPOSE_FILE: "/untrusted.yml",
          COMPOSE_PROFILES: "untrusted",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
  });
const removeProject = (project) => {
  const ids = docker(
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length) docker("rm", "-f", ...ids);
  const volumes = docker(
    "volume",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  if (volumes.length) docker("volume", "rm", ...volumes);
  const networks = docker(
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  if (networks.length) {
    for (const network of networks)
      for (const fixture of [
        `${prefix}-external-db`,
        `${prefix}-external-store`,
      ]) {
        try {
          docker("network", "disconnect", network, fixture);
        } catch {
          /* The fixture may not exist after a preceding failure. */
        }
      }
    docker("network", "rm", ...networks);
  }
};

test(
  "four topologies × HTTPS providers, isolated real startup and persistence",
  { timeout: 3600000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "chalktalk-runtime-"));
    const dbName = `${prefix}-external-db`;
    const storeName = `${prefix}-external-store`;
    try {
      docker(
        "run",
        "-d",
        "--name",
        dbName,
        "-e",
        "POSTGRES_PASSWORD=fixture-secret",
        "-e",
        "POSTGRES_DB=fixture",
        "-p",
        "127.0.0.1::5432",
        "pgvector/pgvector:pg17",
      );
      docker(
        "run",
        "-d",
        "--name",
        storeName,
        "-e",
        "AWS_ACCESS_KEY_ID=fixture-key",
        "-e",
        "AWS_SECRET_ACCESS_KEY=fixture-secret",
        "-p",
        "127.0.0.1::8333",
        "chrislusf/seaweedfs:4.48",
        "mini",
        "-dir=/data",
      );
      const dbPort = docker("port", dbName, "5432").split(":").at(-1);
      const storePort = docker("port", storeName, "8333").split(":").at(-1);
      // Fixture provisioning is explicit and outside product startup. No real provider.
      const { Pool } = await import("pg");
      const {
        S3Client,
        CreateBucketCommand,
        PutObjectCommand,
        GetObjectCommand,
        HeadBucketCommand,
      } = await import("@aws-sdk/client-s3");
      const db = new Pool({
        connectionString: `postgresql://postgres:fixture-secret@127.0.0.1:${dbPort}/fixture`,
      });
      for (let attempt = 0; ; attempt++) {
        try {
          await db.query("SELECT 1");
          break;
        } catch (error) {
          if (attempt === 60) throw error;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      const s3 = new S3Client({
        endpoint: `http://127.0.0.1:${storePort}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: {
          accessKeyId: "fixture-key",
          secretAccessKey: "fixture-secret",
        },
      });
      for (let attempt = 0; ; attempt++) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: "fixture" }));
          break;
        } catch (error) {
          if (attempt === 60) throw error;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      try {
        // These fixtures prove real phase-2 failures cannot enable traffic or
        // worker claims, even where ordinary migration consent was supplied.
        const failureProject = `${prefix}-failure`;
        const failureNetwork = `${failureProject}_default`;
        docker(
          "network",
          "create",
          "--label",
          `com.docker.compose.project=${failureProject}`,
          "--label",
          "com.docker.compose.network=default",
          failureNetwork,
        );
        docker(
          "network",
          "connect",
          "--alias",
          "external-db",
          failureNetwork,
          dbName,
        );
        docker(
          "network",
          "connect",
          "--alias",
          "external-store",
          failureNetwork,
          storeName,
        );
        await db.query(
          "CREATE ROLE readonly_fixture LOGIN PASSWORD 'synthetic-readonly'",
        );
        const originalCatalog = (
          await db.query(
            "SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY relname",
          )
        ).rows;
        const failureBase = {
          LOCAL_DATABASE_ENABLED: "false",
          LOCAL_OBJECT_STORE_ENABLED: "false",
          DATABASE_URL:
            "postgresql://postgres:fixture-secret@external-db:5432/fixture",
          S3_ENDPOINT: "http://external-store:8333",
          S3_BUCKET: "fixture",
          S3_REGION: "us-east-1",
          S3_ACCESS_KEY_ID: "fixture-key",
          S3_SECRET_ACCESS_KEY: "fixture-secret",
          AUTH_TOKEN_SECRET:
            "synthetic-authentication-secret-with-32-characters",
          METRICS_TOKEN: "synthetic-monitoring-secret-with-32-characters",
          GRAFANA_ADMIN_PASSWORD: "synthetic-grafana",
          EMAIL_PROVIDER: "resend",
          EMAIL_FROM: "mail@example.test",
          RESEND_API_KEY: "synthetic",
          WEB_PORT: String(await freePort()),
          GRAFANA_PORT: String(await freePort()),
        };
        try {
          for (const scenario of [
            {
              name: "external pending without acknowledgment",
              ack: false,
              extra: {},
            },
            {
              name: "external bucket missing with consent",
              ack: true,
              extra: { S3_BUCKET: "missing-owned-fixture-bucket" },
            },
            {
              name: "external bucket denied with consent",
              ack: true,
              extra: { S3_ACCESS_KEY_ID: "denied-synthetic-key" },
            },
            {
              name: "unavailable explicit SES source",
              ack: true,
              extra: {
                EMAIL_PROVIDER: "ses",
                RESEND_API_KEY: undefined,
                SES_REGION: "us-east-1",
                SES_CREDENTIALS_MODE: "default-chain",
                AWS_SHARED_CREDENTIALS_FILE: "/nonexistent-owned-source-file",
              },
            },
            {
              name: "ordinary migration permission failure",
              ack: true,
              extra: {
                DATABASE_URL:
                  "postgresql://readonly_fixture:synthetic-readonly@external-db:5432/fixture",
              },
            },
            {
              name: "external semantic prerequisite missing",
              ack: true,
              extra: { EMBEDDING_API_KEY: "synthetic" },
            },
          ])
            await t.test(scenario.name, { timeout: 300_000 }, async () => {
              const envFile = join(directory, "failure.env");
              writeFileSync(
                envFile,
                Object.entries({ ...failureBase, ...scenario.extra })
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => `${key}=${value}`)
                  .join("\n") + "\n",
              );
              const result = await launch(
                envFile,
                failureProject,
                scenario.ack,
              );
              assert.notEqual(result.status, 0, result.output);
              assert.doesNotMatch(
                result.output,
                /fixture-secret|synthetic-readonly/,
              );
              if (scenario.extra.S3_BUCKET)
                await assert.rejects(
                  s3.send(
                    new HeadBucketCommand({ Bucket: scenario.extra.S3_BUCKET }),
                  ),
                  (error) => error.$metadata?.httpStatusCode === 404,
                );
              assert.deepEqual(
                (
                  await db.query(
                    "SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY relname",
                  )
                ).rows,
                originalCatalog,
              );
              const running = docker(
                "ps",
                "--filter",
                `label=com.docker.compose.project=${failureProject}`,
                "--format",
                '{{.Label "com.docker.compose.service"}}',
              ).split("\n");
              for (const service of [
                "api",
                "worker",
                "web",
                "gateway",
                "collaboration",
              ])
                assert.ok(!running.includes(service));
            });
        } finally {
          removeProject(failureProject);
        }
        if (!process.env.RUNTIME_FAILURE_ONLY)
          for (const localDb of [true, false])
            for (const localStore of [true, false])
              for (const provider of [
                "resend",
                "sendgrid",
                "ses",
                "ses-default-chain",
              ])
                if (
                  !process.env.RUNTIME_CASE_FILTER ||
                  `${localDb}/${localStore}/${provider}` ===
                    process.env.RUNTIME_CASE_FILTER
                )
                  await t.test(
                    `${localDb}/${localStore}/${provider}`,
                    { timeout: 600000 },
                    async () => {
                      const project = `${prefix}-${Number(localDb)}${Number(localStore)}`;
                      const network = `${project}_default`;
                      let networkState;
                      try {
                        networkState = JSON.parse(
                          docker("network", "inspect", network),
                        )[0];
                      } catch {
                        docker(
                          "network",
                          "create",
                          "--label",
                          `com.docker.compose.project=${project}`,
                          "--label",
                          "com.docker.compose.network=default",
                          network,
                        );
                        networkState = JSON.parse(
                          docker("network", "inspect", network),
                        )[0];
                      }
                      for (const [fixture, alias] of [
                        [dbName, "external-db"],
                        [storeName, "external-store"],
                      ])
                        if (
                          !Object.values(networkState.Containers ?? {}).some(
                            (container) => container.Name === fixture,
                          )
                        )
                          docker(
                            "network",
                            "connect",
                            "--alias",
                            alias,
                            network,
                            fixture,
                          );
                      const webPort = await freePort();
                      const grafanaPort = await freePort();
                      const bundledS3Port =
                        localDb && localStore && provider === "resend"
                          ? await freePort()
                          : undefined;
                      const settings = {
                        LOCAL_DATABASE_ENABLED: String(localDb),
                        LOCAL_OBJECT_STORE_ENABLED: String(localStore),
                        ...(bundledS3Port
                          ? {
                              LOCAL_OBJECT_STORE_HOST_PORT:
                                String(bundledS3Port),
                            }
                          : {}),
                        AUTH_TOKEN_SECRET:
                          "synthetic-authentication-secret-32-characters",
                        METRICS_TOKEN:
                          "synthetic-monitoring-secret-at-least-32-characters",
                        GRAFANA_ADMIN_PASSWORD: "synthetic-grafana-password",
                        DOMAIN: "localhost",
                        WEB_PORT: String(webPort),
                        GRAFANA_PORT: String(grafanaPort),
                        EMAIL_PROVIDER: provider.startsWith("ses")
                          ? "ses"
                          : provider,
                        EMAIL_FROM: "ChalkTalk <mail@example.test>",
                        ...(provider === "resend"
                          ? { RESEND_API_KEY: "synthetic" }
                          : {}),
                        ...(provider === "sendgrid"
                          ? { SENDGRID_API_KEY: "synthetic" }
                          : {}),
                        ...(provider.startsWith("ses")
                          ? {
                              SES_REGION: "us-east-1",
                              SES_CREDENTIALS_MODE:
                                provider === "ses"
                                  ? "explicit"
                                  : "default-chain",
                              ...(provider === "ses"
                                ? {
                                    SES_ACCESS_KEY_ID: "synthetic",
                                    SES_SECRET_ACCESS_KEY: "synthetic",
                                  }
                                : {
                                    AWS_ACCESS_KEY_ID: "synthetic",
                                    AWS_SECRET_ACCESS_KEY: "synthetic",
                                  }),
                            }
                          : {}),
                        ...(!localDb
                          ? {
                              DATABASE_URL: `postgresql://postgres:fixture-secret@external-db:5432/fixture`,
                            }
                          : {}),
                        ...(!localStore
                          ? {
                              S3_ENDPOINT: `http://external-store:8333`,
                              S3_BUCKET: "fixture",
                              S3_REGION: "us-east-1",
                              S3_ACCESS_KEY_ID: "fixture-key",
                              S3_SECRET_ACCESS_KEY: "fixture-secret",
                            }
                          : {}),
                      };
                      const envFile = join(directory, `${project}.env`);
                      writeFileSync(
                        envFile,
                        Object.entries(settings)
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n") + "\n",
                      );
                      try {
                        const result = await launch(envFile, project, !localDb);
                        if (result.status !== 0) console.error(result.output);
                        assert.equal(result.status, 0, result.output);
                        assert.doesNotMatch(
                          result.output,
                          /fixture-secret|synthetic-authentication/,
                        );
                        const names = docker(
                          "ps",
                          "--filter",
                          `label=com.docker.compose.project=${project}`,
                          "--format",
                          '{{.Label "com.docker.compose.service"}}',
                        ).split("\n");
                        assert.equal(names.includes("postgres"), localDb);
                        assert.equal(names.includes("seaweedfs"), localStore);
                        assert.ok(names.includes("api"));
                        assert.ok(names.includes("worker"));
                        const apiId = docker(
                          "ps",
                          "-q",
                          "--filter",
                          `label=com.docker.compose.project=${project}`,
                          "--filter",
                          "label=com.docker.compose.service=api",
                        );
                        const identity = docker(
                          "exec",
                          apiId,
                          "node",
                          "--import",
                          "tsx",
                          "--input-type=module",
                          "-e",
                          `
                        import {Pool} from 'pg';
                        import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
                        import {loadObjectStorageConfig} from './apps/api/src/config/environment.ts';
                        const pool=new Pool({connectionString:process.env.DATABASE_URL});
                        const database=(await pool.query('SELECT current_database() AS name')).rows[0].name;
                        if(database!==${JSON.stringify(localDb ? "chalktalk" : "fixture")})throw new Error('wrong database identity');
                        for(const table of ['users','courses'])if((await pool.query('SELECT count(*) FROM '+table)).rows[0].count!=='0')throw new Error('unexpected seed data');
                        await pool.query('CREATE TABLE IF NOT EXISTS ct_local_fixture_marker (id text PRIMARY KEY,value text NOT NULL)');
                        await pool.query("INSERT INTO ct_local_fixture_marker VALUES ('retained','owned fixture') ON CONFLICT DO NOTHING");
                        if((await pool.query("SELECT value FROM ct_local_fixture_marker WHERE id='retained'")).rows[0].value!=='owned fixture')throw new Error('database persistence lost');
                        const storage=loadObjectStorageConfig();const client=new S3Client(storage.client);
                        await client.send(new PutObjectCommand({Bucket:storage.bucket,Key:'matrix-retained',Body:'owned fixture'}));
                        if(await(await client.send(new GetObjectCommand({Bucket:storage.bucket,Key:'matrix-retained'}))).Body.transformToString()!=='owned fixture')throw new Error('object roundtrip failed');
                        client.destroy();await pool.end();console.log('verified');
                      `,
                        );
                        assert.equal(identity, "verified");
                        assert.equal(
                          docker(
                            "exec",
                            apiId,
                            "node",
                            "-e",
                            "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1);console.log('ready')})",
                          ),
                          "ready",
                        );
                        if (!localStore) {
                          await s3.send(
                            new PutObjectCommand({
                              Bucket: "fixture",
                              Key: "persistence",
                              Body: "owned fixture",
                            }),
                          );
                          assert.equal(
                            await (
                              await s3.send(
                                new GetObjectCommand({
                                  Bucket: "fixture",
                                  Key: "persistence",
                                }),
                              )
                            ).Body.transformToString(),
                            "owned fixture",
                          );
                        }
                        if (localDb && localStore && provider === "resend") {
                          const smokeEnv = {
                            ...process.env,
                            TEST_PROJECT_NAME: project,
                            DOMAIN: "localhost",
                            WEB_PORT: String(webPort),
                            GRAFANA_PORT: String(grafanaPort),
                            TEST_GRAFANA_PASSWORD: "synthetic-grafana-password",
                            TEST_S3_ENDPOINT: `http://127.0.0.1:${bundledS3Port}`,
                            TEST_S3_ACCESS_KEY_ID: "chalktalk-local",
                            TEST_S3_SECRET_ACCESS_KEY: "chalktalk-local-secret",
                          };
                          for (const script of [
                            "test-seaweedfs-s3.sh",
                            "test-caddy-gateway.sh",
                            "test-observability.sh",
                          ])
                            execFileSync(
                              "/bin/sh",
                              [`deployment/local/tests/${script}`],
                              {
                                cwd: root,
                                env: smokeEnv,
                                encoding: "utf8",
                                timeout: 360_000,
                                stdio: ["ignore", "pipe", "pipe"],
                              },
                            );
                        }
                        if (
                          localDb &&
                          localStore &&
                          provider === "ses-default-chain"
                        ) {
                          const workerId = docker(
                            "ps",
                            "-q",
                            "--filter",
                            `label=com.docker.compose.project=${project}`,
                            "--filter",
                            "label=com.docker.compose.service=worker",
                          );
                          docker(
                            "exec",
                            workerId,
                            "./node_modules/.bin/vitest",
                            "run",
                            "--project",
                            "api",
                            "apps/api/src/auth/email.ses.refresh.test.ts",
                          );
                        }
                        if (localDb && localStore && provider === "resend") {
                          const before = docker(
                            "inspect",
                            apiId,
                            "--format",
                            "{{json .Mounts}}",
                          );
                          const again = await launch(envFile, project);
                          assert.equal(again.status, 0, again.output);
                          const restartedApi = docker(
                            "ps",
                            "-q",
                            "--filter",
                            `label=com.docker.compose.project=${project}`,
                            "--filter",
                            "label=com.docker.compose.service=api",
                          );
                          const after = docker(
                            "inspect",
                            restartedApi,
                            "--format",
                            "{{json .Mounts}}",
                          );
                          assert.deepEqual(
                            mountSnapshot(after),
                            mountSnapshot(before),
                          );
                        }
                      } finally {
                        if (
                          process.env.RUNTIME_CASE_FILTER ||
                          provider === "ses-default-chain"
                        )
                          removeProject(project);
                      }
                    },
                  );
      } finally {
        await db.end();
        s3.destroy();
      }
    } finally {
      for (const name of [dbName, storeName]) {
        try {
          docker("rm", "-f", name);
        } catch {
          /* The fixture may not exist after a preceding failure. */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
