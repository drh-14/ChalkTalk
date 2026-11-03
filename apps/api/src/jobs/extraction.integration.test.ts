import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import type { ExtractionOptions } from "../resource-text/extract.js";
import { queueFileTextExtraction } from "../resource-text/queue.js";
import type { ExtractedText } from "../resource-text/store.js";
import { ExtractionFailure } from "../resource-text/tools.js";
import { JobWorker, type ResourceTextWorkerOptions } from "./worker.js";

const url = process.env.TEST_DATABASE_URL,
  endpoint = process.env.TEST_S3_ENDPOINT,
  suite = url && endpoint ? describe : describe.skip,
  schema = `extraction_jobs_${process.pid}_${Date.now()}`,
  bucket = `extraction-${process.pid}-${Date.now()}`,
  s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "chalktalk-local",
      secretAccessKey: "chalktalk-local-secret",
    },
  });
const org = randomUUID(),
  user = randomUUID();
let pool: Pool, admin: Pool;

type Extract = NonNullable<ResourceTextWorkerOptions["extract"]>;
const worker = (
  overrides: Partial<ResourceTextWorkerOptions> = {},
  id = `extraction-${randomUUID()}`,
  database: Pool = pool,
  store: S3Client = s3,
) =>
  new JobWorker(
    database,
    id,
    undefined,
    undefined,
    { client: store, bucket },
    undefined,
    undefined,
    { maxOcrPages: 200, ocrLanguages: "eng", ...overrides },
  );

async function seedCourse() {
  const course = randomUUID();
  await pool.query(
    "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course',$4)",
    [course, org, user, randomUUID().slice(0, 8).toUpperCase()],
  );
  return course;
}

/** Stores bytes and makes them a live catalog file with a queued extraction, as an upload would. */
async function seedFile(
  contents = "Spectral theorem notes",
  mediaType = "text/plain",
  course?: string,
) {
  const courseId = course ?? (await seedCourse()),
    fileId = randomUUID(),
    objectKey = `courses/${courseId}/files/${fileId}`,
    revision = randomUUID();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: contents }),
  );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO course_files(id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES($1,$2,$3,$4,'notes',$5,$6,$7)",
      [
        fileId,
        courseId,
        user,
        objectKey,
        mediaType,
        Buffer.byteLength(contents),
        createHash("sha256").update(contents).digest(),
      ],
    );
    await db.query(
      "INSERT INTO course_resources(id,course_id,title,visibility,position,active_revision_id) VALUES($1,$2,'Notes','class',0,$3)",
      [fileId, courseId, revision],
    );
    await db.query(
      "INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,file_id) VALUES($1,$2,$3,'upload',$2)",
      [revision, fileId, courseId],
    );
    await queueFileTextExtraction(db, courseId, fileId);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  return { courseId, fileId, objectKey };
}

const job = async (fileId: string) =>
  (
    await pool.query<{
      id: string;
      status: string;
      attempts: number;
      locked_until: Date | null;
      last_error: string | null;
    }>(
      "SELECT id,status,attempts,locked_until,last_error FROM jobs WHERE kind='extract_file_text' AND payload->>'fileId'=$1",
      [fileId],
    )
  ).rows[0]!;
const text = async (fileId: string) =>
  (
    await pool.query<{
      status: string;
      text: string | null;
      failure_code: string | null;
    }>(
      "SELECT status,text,failure_code FROM course_file_texts WHERE file_id=$1",
      [fileId],
    )
  ).rows[0];
/** Drains earlier tests' queued extraction jobs so each test sees only its own. */
const clearQueue = () =>
  pool.query(
    "UPDATE jobs SET status='succeeded',finished_at=now() WHERE status IN ('queued','running')",
  );
const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Condition was not reached");
};
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};
const clientFor = (at: string) =>
  new S3Client({
    region: "us-east-1",
    endpoint: at,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: "chalktalk-local",
      secretAccessKey: "chalktalk-local-secret",
    },
  });
/** Runs `work` with a real S3 client whose object store answers with `respond`, or refuses connections. */
async function withObjectStore(
  respond: RequestListener | null,
  work: (client: S3Client) => Promise<void>,
) {
  const server = createServer(respond ?? undefined);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  if (!respond) await close();
  const client = clientFor(`http://127.0.0.1:${port}`);
  try {
    await work(client);
  } finally {
    client.destroy();
    if (respond) await close();
  }
}
const s3Error =
  (status: number, code: string): RequestListener =>
  (_request, response) => {
    response.writeHead(status, { "content-type": "application/xml" });
    response.end(
      `<Error><Code>${code}</Code><Message>${code}</Message></Error>`,
    );
  };
const stalledStores: [string, RequestListener][] = [
  ["request", () => undefined],
  [
    "body stream",
    (_request, response) => {
      response.writeHead(200, { "content-length": "1000" });
      response.write("partial");
    },
  ],
];

suite("resource text extraction jobs", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}",public`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'extract.example.edu','Example')",
      [org],
    );
    await pool.query(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'ada@extract.example.edu','Ada','x')",
      [user, org],
    );
  });
  afterAll(async () => {
    for (const object of (
      await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
    ).Contents ?? [])
      if (object.Key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    s3.destroy();
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  describe("lanes and leases", () => {
    it("keeps extraction and general jobs in separate lanes", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const subject = worker();
      expect(await subject.runOnce("general")).toBe(false);
      await pool.query(
        "INSERT INTO jobs(id,kind,payload) VALUES($1,'delete_course',$2)",
        [randomUUID(), { courseId: randomUUID() }],
      );
      expect(await subject.runOnce("extraction")).toBe(true);
      expect(await subject.runOnce("extraction")).toBe(false);
      expect(await subject.runOnce("general")).toBe(true);
      expect((await job(fileId)).status).toBe("succeeded");
    });

    it("does not delay a queued general job behind a long extraction", async () => {
      await clearQueue();
      const release = gate();
      const { fileId } = await seedFile();
      const subject = worker({
        extract: async () => {
          await release.opened;
          return { text: "slow", truncated: false };
        },
      });
      const extracting = subject.runOnce("extraction");
      await waitFor(async () => (await job(fileId)).status === "running");
      const general = randomUUID();
      await pool.query(
        "INSERT INTO jobs(id,kind,payload) VALUES($1,'delete_course',$2)",
        [general, { courseId: randomUUID() }],
      );
      expect(await subject.runOnce("general")).toBe(true);
      expect(
        (await pool.query("SELECT status FROM jobs WHERE id=$1", [general]))
          .rows[0].status,
      ).toBe("succeeded");
      expect((await job(fileId)).status).toBe("running");
      release.open();
      await extracting;
      expect(await text(fileId)).toMatchObject({
        status: "ready",
        text: "slow",
      });
    });

    it("extends the lease while extraction runs", async () => {
      await clearQueue();
      const release = gate();
      const { fileId } = await seedFile();
      const subject = worker({
        heartbeatMs: 50,
        extract: async () => {
          await release.opened;
          return { text: "kept", truncated: false };
        },
      });
      const extracting = subject.runOnce("extraction");
      await waitFor(async () => (await job(fileId)).status === "running");
      const first = (await job(fileId)).locked_until!;
      await waitFor(
        async () =>
          (await job(fileId)).locked_until!.getTime() > first.getTime(),
      );
      release.open();
      await extracting;
      expect((await job(fileId)).status).toBe("succeeded");
    });

    it.each([0, 2])(
      "leaves text pending after lease takeover with %i prior attempts",
      async (attempts) => {
        await clearQueue();
        const { fileId } = await seedFile();
        await pool.query("UPDATE jobs SET attempts=$2 WHERE id=$1", [
          (await job(fileId)).id,
          attempts,
        ]);
        let aborted = false;
        const subject = worker({
          heartbeatMs: 50,
          extract: (_path, _type, _directory, options: ExtractionOptions) =>
            new Promise<ExtractedText>((_resolve, reject) =>
              options.signal!.addEventListener("abort", () => {
                aborted = true;
                reject(options.signal!.reason);
              }),
            ),
        });
        const extracting = subject.runOnce("extraction");
        await waitFor(async () => (await job(fileId)).status === "running");
        await pool.query(
          "UPDATE jobs SET locked_by='another-worker' WHERE id=$1",
          [(await job(fileId)).id],
        );
        await extracting;
        expect(aborted).toBe(true);
        expect((await text(fileId))!.status).toBe("pending");
        expect((await job(fileId)).status).toBe("running");
      },
    );

    it("does not record a final failure after ownership changes before the heartbeat", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const { id } = await job(fileId);
      await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
      await worker({
        extract: async () => {
          await pool.query(
            "UPDATE jobs SET locked_by='another-worker',attempts=attempts+1 WHERE id=$1",
            [id],
          );
          throw new Error("late tool failure");
        },
      }).runOnce("extraction");
      expect(await job(fileId)).toMatchObject({
        status: "running",
        attempts: 4,
        last_error: null,
      });
      expect((await text(fileId))!.status).toBe("pending");
    });

    describe.each(["ready", "failed", "unsupported", "exhausted"])(
      "%s publication ownership",
      (outcome) => {
        it.each(["owner", "attempt", "expired"])(
          "discards a result blocked behind a changed %s",
          async (changed) => {
            await clearQueue();
            const { fileId } = await seedFile("Current worker result");
            const { id } = await job(fileId);
            await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
            const blocker = await pool.connect();
            const started = gate();
            const release = gate();
            const extracting = worker({
              heartbeatMs: 60_000,
              extract: async () => {
                started.open();
                await release.opened;
                if (outcome === "failed")
                  throw new ExtractionFailure("encrypted_pdf", true);
                if (outcome === "unsupported")
                  throw new ExtractionFailure("unsupported_media_type", true);
                if (outcome === "exhausted") throw new Error("tool failed");
                return { text: "Stale partial result", truncated: true };
              },
            }).runOnce("extraction");
            try {
              await started.opened;
              await blocker.query("BEGIN");
              const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
                .rows[0].pid;
              await blocker.query(
                "SELECT id FROM jobs WHERE id=$1 FOR UPDATE",
                [id],
              );
              release.open();
              await waitFor(
                async () =>
                  (
                    await pool.query(
                      "SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                      [pid],
                    )
                  ).rowCount! > 0,
              );
              await blocker.query(
                changed === "owner"
                  ? "UPDATE jobs SET locked_by='replacement' WHERE id=$1"
                  : changed === "attempt"
                    ? "UPDATE jobs SET attempts=attempts+1 WHERE id=$1"
                    : "UPDATE jobs SET locked_until=clock_timestamp()-interval '1 second' WHERE id=$1",
                [id],
              );
              await blocker.query("COMMIT");
              await extracting;
              expect(await text(fileId)).toEqual({
                status: "pending",
                text: null,
                failure_code: null,
              });
              expect((await job(fileId)).status).toBe("running");
              await pool.query(
                "UPDATE jobs SET locked_until=clock_timestamp()-interval '1 second' WHERE id=$1",
                [id],
              );
              await worker().runOnce("extraction");
              expect(await text(fileId)).toMatchObject({
                status: "ready",
                text: "Current worker result",
              });
            } finally {
              release.open();
              await blocker.query("ROLLBACK");
              blocker.release();
              await extracting;
            }
          },
        );

        it("rolls back when the lease expires while the text write waits", async () => {
          await clearQueue();
          const { fileId } = await seedFile();
          const { id } = await job(fileId);
          await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
          const blocker = await pool.connect();
          const started = gate();
          const release = gate();
          const extracting = worker({
            heartbeatMs: 60_000,
            extract: async () => {
              started.open();
              await release.opened;
              if (outcome === "failed")
                throw new ExtractionFailure("encrypted_pdf", true);
              if (outcome === "unsupported")
                throw new ExtractionFailure("unsupported_media_type", true);
              if (outcome === "exhausted") throw new Error("tool failed");
              return { text: "Expired result", truncated: false };
            },
          }).runOnce("extraction");
          try {
            await started.opened;
            await blocker.query("BEGIN");
            const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
              .rows[0].pid;
            await blocker.query(
              "SELECT file_id FROM course_file_texts WHERE file_id=$1 FOR UPDATE",
              [fileId],
            );
            await pool.query(
              "UPDATE jobs SET locked_until=clock_timestamp()+interval '1 second' WHERE id=$1",
              [id],
            );
            release.open();
            await waitFor(
              async () =>
                (
                  await pool.query(
                    "SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                    [pid],
                  )
                ).rowCount! > 0,
            );
            await waitFor(
              async () =>
                (
                  await pool.query(
                    "SELECT locked_until < clock_timestamp() expired FROM jobs WHERE id=$1",
                    [id],
                  )
                ).rows[0].expired,
            );
            await blocker.query("COMMIT");
            await extracting;
            expect(await text(fileId)).toEqual({
              status: "pending",
              text: null,
              failure_code: null,
            });
            expect((await job(fileId)).status).toBe("running");
          } finally {
            release.open();
            await blocker.query("ROLLBACK");
            blocker.release();
            await extracting;
          }
        });
      },
    );

    it("leaves the final attempt reclaimable after a heartbeat failure", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const { id } = await job(fileId);
      await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
      let rejecting = false;
      const unreachable = new Proxy(pool, {
        get(target, property) {
          if (property === "query" && rejecting)
            return () => Promise.reject(new Error("connection lost"));
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await worker(
        {
          heartbeatMs: 50,
          extract: (_path, _type, _directory, options: ExtractionOptions) =>
            new Promise<ExtractedText>((_resolve, reject) => {
              rejecting = true;
              options.signal!.addEventListener("abort", () => {
                rejecting = false;
                reject(options.signal!.reason);
              });
            }),
        },
        undefined,
        unreachable,
      ).runOnce("extraction");
      expect(await job(fileId)).toMatchObject({
        status: "running",
        attempts: 3,
        last_error: null,
      });
      expect((await text(fileId))!.status).toBe("pending");
      await pool.query(
        "UPDATE jobs SET locked_until=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      await worker().runOnce("extraction");
      expect((await job(fileId)).status).toBe("succeeded");
      expect((await text(fileId))!.status).toBe("ready");
    });

    it("reclaims an extraction whose lease expired", async () => {
      await clearQueue();
      const { fileId } = await seedFile("Reclaimed lecture");
      await pool.query(
        "UPDATE jobs SET status='running',attempts=1,locked_by='crashed',locked_until=now()-interval '1 second' WHERE id=$1",
        [(await job(fileId)).id],
      );
      expect(await worker().runOnce("extraction")).toBe(true);
      expect(await job(fileId)).toMatchObject({
        status: "succeeded",
        attempts: 2,
      });
      expect(await text(fileId)).toMatchObject({
        status: "ready",
        text: "Reclaimed lecture",
      });
    });

    it("requeues a running extraction on shutdown without using an attempt", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const shutdown = new AbortController();
      let started = false,
        aborted = false;
      const subject = worker({
        extract: (_path, _type, _directory, options: ExtractionOptions) =>
          new Promise<ExtractedText>((_resolve, reject) => {
            started = true;
            options.signal!.addEventListener("abort", () => {
              aborted = true;
              reject(options.signal!.reason);
            });
          }),
      });
      const extracting = subject.runOnce("extraction", shutdown.signal);
      await waitFor(async () => started);
      shutdown.abort();
      await extracting;
      expect(aborted).toBe(true);
      expect(await job(fileId)).toMatchObject({
        status: "queued",
        attempts: 0,
        locked_until: null,
      });
      expect((await text(fileId))!.status).toBe("pending");

      await worker().runOnce("extraction");
      expect(await job(fileId)).toMatchObject({
        status: "succeeded",
        attempts: 1,
      });
    });

    it("does not record a failure when shutdown interrupts the final attempt", async () => {
      await clearQueue();
      const { fileId } = await seedFile("Finished later");
      await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [
        (await job(fileId)).id,
      ]);
      const shutdown = new AbortController();
      let started = false;
      const interrupted = worker({
        extract: (_path, _type, _directory, options: ExtractionOptions) =>
          new Promise<ExtractedText>((_resolve, reject) => {
            started = true;
            options.signal!.addEventListener("abort", () =>
              reject(options.signal!.reason),
            );
          }),
      }).runOnce("extraction", shutdown.signal);
      await waitFor(async () => started);
      shutdown.abort();
      await interrupted;
      expect(await job(fileId)).toMatchObject({
        status: "queued",
        attempts: 2,
      });
      expect((await text(fileId))!.status).toBe("pending");

      await worker().runOnce("extraction");
      expect(await text(fileId)).toMatchObject({
        status: "ready",
        text: "Finished later",
      });
    });
  });

  describe("attempts and OCR time limits", () => {
    it("gives a job 3 attempts and only the last the 12-minute OCR deadline", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const { id } = await job(fileId);
      expect(
        (await pool.query("SELECT max_attempts FROM jobs WHERE id=$1", [id]))
          .rows[0].max_attempts,
      ).toBe(3);
      const deadlines: (number | undefined)[] = [];
      const subject = worker({
        extract: async (_path, _type, _directory, options) => {
          deadlines.push(options.deadline);
          throw new Error("tesseract crashed");
        },
      });
      await subject.runOnce("extraction");
      await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [id]);
      await subject.runOnce("extraction");
      expect(await job(fileId)).toMatchObject({
        status: "queued",
        attempts: 2,
      });
      await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [id]);
      const before = Date.now();
      await subject.runOnce("extraction");
      const after = Date.now();
      expect(deadlines).toHaveLength(3);
      expect(deadlines.slice(0, 2)).toEqual([undefined, undefined]);
      expect(deadlines[2]).toBeGreaterThanOrEqual(before + 12 * 60_000);
      expect(deadlines[2]).toBeLessThanOrEqual(after + 12 * 60_000);
      expect((await job(fileId)).status).toBe("dead");
      expect(await text(fileId)).toEqual({
        status: "failed",
        text: null,
        failure_code: "retries_exhausted",
      });
    });

    it("stores what the final attempt finished as ready and truncated", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [
        (await job(fileId)).id,
      ]);
      await worker({
        extract: async (_path, _type, _directory, options) => ({
          text: "finished pages",
          truncated: options.deadline !== undefined,
        }),
      }).runOnce("extraction");
      expect(await text(fileId)).toMatchObject({
        status: "ready",
        text: "finished pages",
      });
      expect(
        (
          await pool.query(
            "SELECT truncated FROM course_file_texts WHERE file_id=$1",
            [fileId],
          )
        ).rows[0].truncated,
      ).toBe(true);
    });

    it.each([0, 2])(
      "counts an extraction timeout with %i prior attempts as a failed attempt",
      async (attempts) => {
        await clearQueue();
        const { fileId } = await seedFile();
        await pool.query("UPDATE jobs SET attempts=$2 WHERE id=$1", [
          (await job(fileId)).id,
          attempts,
        ]);
        let extracted = false;
        await worker({
          hardLimitMs: 500,
          extract: (_path, _type, _directory, options: ExtractionOptions) =>
            new Promise<ExtractedText>((_resolve, reject) => {
              extracted = true;
              options.signal!.addEventListener("abort", () =>
                reject(options.signal!.reason),
              );
            }),
        }).runOnce("extraction");
        expect(extracted).toBe(true);
        expect(await job(fileId)).toMatchObject({
          status: attempts === 0 ? "queued" : "dead",
          attempts: attempts + 1,
          last_error: "extraction_timeout",
        });
        expect(await text(fileId)).toEqual({
          status: attempts === 0 ? "pending" : "failed",
          text: null,
          failure_code: attempts === 0 ? null : "retries_exhausted",
        });
      },
    );
  });

  describe("object store availability", () => {
    describe.each([0, 2])("with %i prior attempts", (attempts) => {
      it.each(stalledStores)(
        "requeues a stalled %s at the deadline without using an attempt",
        async (_name, respond) => {
          await clearQueue();
          const { fileId } = await seedFile("Recovered after a stall");
          const { id } = await job(fileId);
          await pool.query("UPDATE jobs SET attempts=$2 WHERE id=$1", [
            id,
            attempts,
          ]);
          let requested = false,
            extracted = false;
          await withObjectStore(
            (request, response) => {
              requested = true;
              respond(request, response);
            },
            async (client) => {
              await worker(
                {
                  hardLimitMs: 500,
                  heartbeatMs: 50,
                  extract: async () => {
                    extracted = true;
                    return { text: "unexpected", truncated: false };
                  },
                },
                undefined,
                undefined,
                client,
              ).runOnce("extraction");
            },
          );
          expect(requested).toBe(true);
          expect(extracted).toBe(false);
          expect(await job(fileId)).toMatchObject({
            status: "queued",
            attempts,
            locked_until: null,
            last_error: "object_store_unavailable",
          });
          expect(await text(fileId)).toEqual({
            status: "pending",
            text: null,
            failure_code: null,
          });
          const { delay } = (
            await pool.query<{ delay: number }>(
              "SELECT EXTRACT(EPOCH FROM available_at-now())::float8 AS delay FROM jobs WHERE id=$1",
              [id],
            )
          ).rows[0]!;
          expect(delay).toBeGreaterThan(50);
          expect(delay).toBeLessThanOrEqual(60);
          await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [
            id,
          ]);
          await worker().runOnce("extraction");
          expect(await job(fileId)).toMatchObject({
            status: "succeeded",
            attempts: attempts + 1,
          });
          expect(await text(fileId)).toMatchObject({
            status: "ready",
            text: "Recovered after a stall",
          });
        },
      );
    });

    describe.each(stalledStores)("during a stalled %s", (_name, respond) => {
      it.each(["shutdown", "lease loss"])(
        "preserves %s precedence on the final attempt",
        async (interruption) => {
          await clearQueue();
          const { fileId } = await seedFile();
          const { id } = await job(fileId);
          await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
          const shutdown = new AbortController();
          let requested = false;
          await withObjectStore(
            (request, response) => {
              requested = true;
              respond(request, response);
            },
            async (client) => {
              const running = worker(
                { hardLimitMs: 5_000, heartbeatMs: 50 },
                undefined,
                undefined,
                client,
              ).runOnce("extraction", shutdown.signal);
              try {
                await waitFor(async () => requested);
                if (interruption === "shutdown") shutdown.abort();
                else
                  await pool.query(
                    "UPDATE jobs SET locked_by='another-worker' WHERE id=$1",
                    [id],
                  );
                await running;
              } finally {
                shutdown.abort();
                await running;
              }
            },
          );
          expect(await job(fileId)).toMatchObject({
            status: interruption === "shutdown" ? "queued" : "running",
            attempts: interruption === "shutdown" ? 2 : 3,
            last_error: null,
          });
          expect(await text(fileId)).toEqual({
            status: "pending",
            text: null,
            failure_code: null,
          });
        },
      );
    });

    it.each<[string, RequestListener | null]>([
      ["a refused connection", null],
      ["a 500 response", s3Error(500, "InternalError")],
      ["a 503 response", s3Error(503, "ServiceUnavailable")],
      [
        "a body that stops mid-download",
        (_request, response) => {
          response.writeHead(200, { "content-length": "1000" });
          response.write("partial", () => response.destroy());
        },
      ],
    ])(
      "requeues the final attempt after %s without using it",
      async (_name, respond) => {
        await clearQueue();
        const { fileId } = await seedFile("Back after the outage");
        const { id } = await job(fileId);
        await pool.query("UPDATE jobs SET attempts=2 WHERE id=$1", [id]);
        let extracted = false;
        await withObjectStore(respond, async (client) => {
          const subject = worker(
            {
              extract: async () => {
                extracted = true;
                return { text: "unexpected", truncated: false };
              },
            },
            undefined,
            undefined,
            client,
          );
          expect(await subject.runOnce("extraction")).toBe(true);
          expect(await subject.runOnce("extraction")).toBe(false);
        });
        expect(extracted).toBe(false);
        expect(await job(fileId)).toMatchObject({
          status: "queued",
          attempts: 2,
          locked_until: null,
          last_error: "object_store_unavailable",
        });
        expect((await text(fileId))!.status).toBe("pending");
        const { delay } = (
          await pool.query<{ delay: number }>(
            "SELECT EXTRACT(EPOCH FROM available_at-now())::float8 AS delay FROM jobs WHERE id=$1",
            [id],
          )
        ).rows[0]!;
        expect(delay).toBeGreaterThan(50);
        expect(delay).toBeLessThanOrEqual(60);

        await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [
          id,
        ]);
        await worker().runOnce("extraction");
        expect(await job(fileId)).toMatchObject({
          status: "succeeded",
          attempts: 3,
        });
        expect(await text(fileId)).toMatchObject({
          status: "ready",
          text: "Back after the outage",
        });
      },
    );

    it.each<[string, RequestListener | null]>([
      ["a missing object", null],
      ["a forbidden object", s3Error(403, "AccessDenied")],
    ])("counts %s as a failed attempt", async (_name, respond) => {
      await clearQueue();
      const { fileId, objectKey } = await seedFile();
      const { id } = await job(fileId);
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      const run = async () => {
        if (!respond) return worker().runOnce("extraction");
        await withObjectStore(respond, (client) =>
          worker({}, undefined, undefined, client)
            .runOnce("extraction")
            .then(() => undefined),
        );
      };
      await run();
      expect(await job(fileId)).toMatchObject({
        status: "queued",
        attempts: 1,
      });
      expect((await job(fileId)).last_error).not.toBe(
        "object_store_unavailable",
      );
      expect((await text(fileId))!.status).toBe("pending");

      await pool.query(
        "UPDATE jobs SET attempts=2,available_at=now() WHERE id=$1",
        [id],
      );
      await run();
      expect((await job(fileId)).status).toBe("dead");
      expect(await text(fileId)).toEqual({
        status: "failed",
        text: null,
        failure_code: "retries_exhausted",
      });
    });
  });

  describe("extract_file_text handler", () => {
    it("downloads, extracts and stores ready text", async () => {
      await clearQueue();
      const { fileId } = await seedFile("Jordan normal form\r\n\r\n\r\nblocks");
      expect(await worker().runOnce("extraction")).toBe(true);
      expect(await text(fileId)).toEqual({
        status: "ready",
        text: "Jordan normal form\n\nblocks",
        failure_code: null,
      });
    });

    it("records permanent failures and unsupported types without retrying", async () => {
      await clearQueue();
      const encrypted = await seedFile("x", "application/pdf");
      await worker({
        extract: async () => {
          throw new ExtractionFailure("encrypted_pdf", true);
        },
      }).runOnce("extraction");
      expect(await text(encrypted.fileId)).toEqual({
        status: "failed",
        text: null,
        failure_code: "encrypted_pdf",
      });
      expect(await job(encrypted.fileId)).toMatchObject({
        status: "succeeded",
        attempts: 1,
      });

      const zipped = await seedFile("x", "application/zip");
      await worker().runOnce("extraction");
      expect(await text(zipped.fileId)).toMatchObject({
        status: "unsupported",
        failure_code: "unsupported_media_type",
      });
    });

    it("retries transient failures, then marks the text failed when attempts run out", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      await pool.query("UPDATE jobs SET max_attempts=2 WHERE id=$1", [
        (await job(fileId)).id,
      ]);
      const flaky = worker({
        extract: async () => {
          throw new Error("tesseract crashed");
        },
      });
      await flaky.runOnce("extraction");
      expect(await job(fileId)).toMatchObject({
        status: "queued",
        attempts: 1,
        last_error: "tesseract crashed",
      });
      expect((await text(fileId))!.status).toBe("pending");
      await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [
        (await job(fileId)).id,
      ]);
      await flaky.runOnce("extraction");
      expect((await job(fileId)).status).toBe("dead");
      expect(await text(fileId)).toEqual({
        status: "failed",
        text: null,
        failure_code: "retries_exhausted",
      });
    });

    it("writes nothing when the text row is cleaned up mid-job", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      const extract: Extract = async () => {
        await pool.query("DELETE FROM course_file_texts WHERE file_id=$1", [
          fileId,
        ]);
        return { text: "late", truncated: false };
      };
      await worker({ extract }).runOnce("extraction");
      expect(await text(fileId)).toBeUndefined();
      expect((await job(fileId)).status).toBe("succeeded");
    });

    it("skips files that were removed before extraction ran", async () => {
      await clearQueue();
      const { fileId } = await seedFile();
      await pool.query("UPDATE course_files SET deleted_at=now() WHERE id=$1", [
        fileId,
      ]);
      let called = false;
      await worker({
        extract: async () => {
          called = true;
          return { text: "x", truncated: false };
        },
      }).runOnce("extraction");
      expect(called).toBe(false);
      expect((await text(fileId))!.status).toBe("pending");
      expect((await job(fileId)).status).toBe("succeeded");
    });
  });

  describe("cleanup", () => {
    it("deletes a retired file's text with its bytes", async () => {
      await clearQueue();
      const { fileId, courseId, objectKey } = await seedFile();
      await worker().runOnce("extraction");
      await pool.query(
        "UPDATE course_resources SET deleted_at=now() WHERE id=$1",
        [fileId],
      );
      await pool.query("UPDATE course_files SET deleted_at=now() WHERE id=$1", [
        fileId,
      ]);
      await pool.query(
        "INSERT INTO jobs(id,kind,payload,deduplication_key) VALUES($1,'delete_course_file',$2,$3)",
        [
          randomUUID(),
          { courseId, fileId, objectKey },
          `file-delete:${fileId}`,
        ],
      );
      expect(await worker().runOnce("general")).toBe(true);
      expect(await text(fileId)).toBeUndefined();
    });

    it("removes extracted text when the course is deleted", async () => {
      await clearQueue();
      const { fileId, courseId } = await seedFile();
      await worker().runOnce("extraction");
      expect((await text(fileId))!.status).toBe("ready");
      await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
        courseId,
      ]);
      await pool.query(
        "INSERT INTO jobs(id,kind,payload) VALUES($1,'delete_course',$2)",
        [randomUUID(), { courseId }],
      );
      expect(await worker().runOnce("general")).toBe(true);
      expect(
        (await pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]))
          .rowCount,
      ).toBe(0);
      expect(await text(fileId)).toBeUndefined();
    });
  });
});
