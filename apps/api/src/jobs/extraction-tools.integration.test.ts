import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { v7 as uuid } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { queueFileTextExtraction } from "../resource-text/queue.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `worker_tools_${process.pid}_${Date.now()}`;
const workerPath = fileURLToPath(new URL("./main.ts", import.meta.url));
const organizationId = uuid();
const userId = uuid();
const courseId = uuid();
const fileId = uuid();
const generalJobId = uuid();
let admin: Pool;
let pool: Pool;
let emptyPath: string;
let worker: ChildProcess | undefined;

integration("worker without the extraction toolchain", () => {
  beforeAll(async () => {
    emptyPath = await mkdtemp(join(tmpdir(), "chalktalk-empty-path-"));
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path=${schema}`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'tools.example.edu','Tools')",
      [organizationId],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'tools@tools.example.edu','Tools','x')",
      [userId, organizationId],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Tools course','ABCDEFGH')",
      [courseId, organizationId, userId],
    );
    await pool.query(
      "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'text/plain','notes.txt',1,$4)",
      [
        fileId,
        courseId,
        `course-files/${courseId}/notes.txt`,
        Buffer.alloc(32),
      ],
    );
    const client = await pool.connect();
    try {
      await queueFileTextExtraction(client, courseId, fileId);
    } finally {
      client.release();
    }
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,max_attempts) VALUES ($1,'delete_course',$2,5)",
      [generalJobId, { courseId: uuid() }],
    );
  });

  afterAll(async () => {
    if (worker?.exitCode === null) worker.kill("SIGTERM");
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await rm(emptyPath, { recursive: true, force: true });
  });

  it("logs the error, keeps running general jobs and leaves extraction jobs unclaimed", async () => {
    worker = spawn(process.execPath, ["--import", "tsx", workerPath], {
      env: {
        ...process.env,
        PATH: emptyPath,
        DATABASE_URL: `${url}?options=-csearch_path%3D${schema}`,
        AUTH_TOKEN_SECRET: "test-secret-with-at-least-32-characters",
        S3_BUCKET: "test-course-files",
        S3_REGION: "us-east-1",
        S3_ENDPOINT: "http://127.0.0.1:1",
        S3_ACCESS_KEY_ID: "test-access-key",
        S3_SECRET_ACCESS_KEY: "test-secret-key",
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    worker.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    for (let attempt = 0; ; attempt += 1) {
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM jobs WHERE id=$1",
        [generalJobId],
      );
      if (rows[0]?.status === "succeeded") break;
      if (worker.exitCode !== null) throw new Error("Worker process exited");
      if (attempt === 200) throw new Error("General job did not run");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const events = output
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event?: string; level?: number });
    expect(
      events.find((entry) => entry.event === "resource_text_tools_unavailable")
        ?.level,
    ).toBe(50);
    const { rows: jobs } = await pool.query(
      "SELECT status,attempts FROM jobs WHERE kind='extract_file_text' AND payload->>'fileId'=$1",
      [fileId],
    );
    expect(jobs).toEqual([{ status: "queued", attempts: 0 }]);
    const { rows: texts } = await pool.query(
      "SELECT status FROM course_file_texts WHERE file_id=$1",
      [fileId],
    );
    expect(texts).toEqual([{ status: "pending" }]);
  }, 30_000);
});
