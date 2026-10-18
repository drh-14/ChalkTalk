import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `worker_process_${process.pid}_${Date.now()}`;
const organizationId = uuidv7();
const ownerId = uuidv7();
const courseId = uuidv7();
const jobId = uuidv7();
const fileJobId = uuidv7();
const courseObjectKey = `course-files/${courseId}/notes.txt`;
const fileObjectKey = `course-files/${courseId}/deleted.txt`;
const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));
const workerPath = fileURLToPath(new URL("./main.ts", import.meta.url));
const port = 30_000 + Math.floor(Math.random() * 20_000);
let admin: Pool;
let pool: Pool;
let s3: Server;
let s3Endpoint: string;
const deletedObjects: string[] = [];
const children: ChildProcess[] = [];

const start = (path: string): ChildProcess => {
  const processHandle = spawn(process.execPath, ["--import", "tsx", path], {
    env: {
      ...process.env,
      DATABASE_URL: `${url}?options=-csearch_path%3D${schema}`,
      AUTH_TOKEN_SECRET: "test-secret-with-at-least-32-characters",
      PORT: String(port),
      S3_BUCKET: "test-course-files",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    },
    stdio: "ignore",
  });
  children.push(processHandle);
  return processHandle;
};

const waitFor = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for process state");
};

integration("separate HTTP and job worker processes", () => {
  beforeAll(async () => {
    s3 = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/test-course-files/" && request.method === "HEAD") {
        response.writeHead(200).end();
      } else if (
        path.startsWith("/test-course-files/") &&
        request.method === "DELETE"
      ) {
        deletedObjects.push(path.slice("/test-course-files/".length));
        response.writeHead(204).end();
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => s3.listen(0, "127.0.0.1", resolve));
    s3Endpoint = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path=${schema}`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'worker.example.edu','Worker')",
      [organizationId],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'worker@worker.example.edu','Worker','x')",
      [ownerId, organizationId],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Worker course','ABCDEFGH')",
      [courseId, organizationId, ownerId],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [courseId, ownerId],
    );
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,max_attempts) VALUES ($1,'delete_course',$2,5)",
      [jobId, { courseId }],
    );
    await pool.query(
      "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'text/plain','notes.txt',1,$4)",
      [uuidv7(), courseId, courseObjectKey, Buffer.alloc(32)],
    );
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,max_attempts) VALUES ($1,'delete_course_file',$2,5)",
      [fileJobId, { objectKey: fileObjectKey }],
    );
  });

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await new Promise<void>((resolve) => s3?.close(() => resolve()));
  });

  it("serves HTTP without claiming the job, then drains it in the worker", async () => {
    const api = start(serverPath);
    await waitFor(async () => {
      if (api.exitCode !== null) throw new Error("API process exited");
      try {
        return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {
        return false;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const queued = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id=ANY($1)",
      [[jobId, fileJobId]],
    );
    expect(queued.rows.map((row) => row.status)).toEqual(["queued", "queued"]);
    expect(deletedObjects).toEqual([]);

    const worker = start(workerPath);
    await waitFor(async () => {
      if (worker.exitCode !== null) throw new Error("Worker process exited");
      const result = await pool.query<{ status: string }>(
        "SELECT status FROM jobs WHERE id=ANY($1)",
        [[jobId, fileJobId]],
      );
      return (
        result.rows.length === 2 &&
        result.rows.every((row) => row.status === "succeeded")
      );
    });
    expect(deletedObjects.sort()).toEqual(
      [courseObjectKey, fileObjectKey].sort(),
    );
    expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
    worker.kill("SIGTERM");
    await waitFor(async () => worker.exitCode !== null);
    expect(worker.exitCode).toBe(0);

    const nextCourseId = uuidv7();
    const nextJobId = uuidv7();
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Second course','ABCDEFGH')",
      [nextCourseId, organizationId, ownerId],
    );
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,max_attempts) VALUES ($1,'delete_course',$2,5)",
      [nextJobId, { courseId: nextCourseId }],
    );
    const restarted = start(workerPath);
    await waitFor(async () => {
      if (restarted.exitCode !== null)
        throw new Error("Restarted worker exited");
      const result = await pool.query<{ status: string }>(
        "SELECT status FROM jobs WHERE id=$1",
        [nextJobId],
      );
      return result.rows[0]?.status === "succeeded";
    });
  }, 15_000);
});
