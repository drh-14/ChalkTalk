import { Pool } from "pg";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { ThreadAttachmentService } from "../threads/attachments.js";
import { ThreadService } from "../threads/service.js";
import { JobWorker } from "../jobs/worker.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const endpoint = process.env.TEST_S3_ENDPOINT;
const integration = databaseUrl && endpoint ? describe : describe.skip;
const schema = `thread_attachments_${process.pid}_${Date.now()}`;
const bucket = `thread-attachments-${process.pid}-${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  author: uuidv7(),
  reader: uuidv7(),
  staff: uuidv7(),
  outsider: uuidv7(),
  board: uuidv7(),
  conversation: uuidv7(),
  message: uuidv7(),
  archiveMessage: uuidv7(),
  deleteMessage: uuidv7(),
};
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const s3 = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
    secretAccessKey:
      process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
  },
});
let admin: Pool;
let pool: Pool;
function app(userId: string, store = s3) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "u@example.edu",
          displayName: "User",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        csrfToken: "csrf",
      }),
    } as AuthService,
    threadAttachmentService: new ThreadAttachmentService(pool, store, bucket),
    threadService: new ThreadService(pool),
  });
}
function upload(
  userId: string,
  key = uuidv7(),
  messageId = ids.message,
  store = s3,
) {
  return request(app(userId, store))
    .post(`/api/v1/thread-messages/${messageId}/attachments`)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf")
    .set("Idempotency-Key", key)
    .attach("file", Buffer.from("hello"), {
      filename: "notes.txt",
      contentType: "text/plain",
    });
}
function get(userId: string, id: string) {
  return request(app(userId))
    .get(`/api/v1/thread-attachments/${id}/download`)
    .set("Cookie", "__Host-chalktalk_session=opaque");
}
function remove(userId: string, id: string) {
  return request(app(userId))
    .delete(`/api/v1/thread-attachments/${id}`)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
integration("Thread attachment persistence and authorization", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [name, id] of Object.entries({
      author: ids.author,
      reader: ids.reader,
      staff: ids.staff,
      outsider: ids.outsider,
    }))
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.org, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta')",
      [ids.course, ids.author, ids.reader, ids.staff],
    );
    await pool.query(
      "INSERT INTO thread_boards(id,course_id,title) VALUES ($1,$2,'Teams')",
      [ids.board, ids.course],
    );
    await pool.query(
      "INSERT INTO thread_conversations(id,course_id,board_id) VALUES ($1,$2,$3)",
      [ids.conversation, ids.course, ids.board],
    );
    await pool.query(
      "INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown) VALUES ($1,$2,$3,$4,1,$5,'student','Team?')",
      [ids.message, ids.course, ids.board, ids.conversation, ids.author],
    );
    await pool.query(
      "INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown) VALUES ($1,$2,$3,$4,2,$5,'student','Another message')",
      [ids.archiveMessage, ids.course, ids.board, ids.conversation, ids.author],
    );
    await pool.query(
      "INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown) VALUES ($1,$2,$3,$4,3,$5,'student','Delete me')",
      [ids.deleteMessage, ids.course, ids.board, ids.conversation, ids.author],
    );
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    for (const object of objects.Contents ?? [])
      if (object.Key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  });
  it("uploads after a saved message, reads as a current member, denies outsiders and non-editors", async () => {
    const created = await upload(ids.author, "first");
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      fileName: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 5,
    });
    const id = created.body.data.id as string;
    const retry = await upload(ids.author, "first");
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(id);
    expect((await get(ids.reader, id)).text).toBe("hello");
    expect((await get(ids.outsider, id)).status).toBe(404);
    expect((await remove(ids.reader, id)).status).toBe(403);
    expect((await remove(ids.staff, id)).status).toBe(204);
    expect((await get(ids.reader, id)).status).toBe(404);
    const jobs = await pool.query<{
      id: string;
      payload: { objectKey: string };
    }>(
      "SELECT id,payload FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key=$1",
      [`thread-attachment-delete:${id}`],
    );
    expect(jobs.rowCount).toBe(1);
    const worker = new JobWorker(pool, undefined, undefined, undefined, {
      client: s3,
      bucket,
    });
    expect(await worker.runOnce()).toBe(true);
    const completed = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id=$1",
      [jobs.rows[0].id],
    );
    expect(completed.rows[0].status).toBe("succeeded");
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: jobs.rows[0].payload.objectKey,
        }),
      ),
    ).rejects.toBeDefined();
  });
  it("revokes downloads immediately when a reader leaves the course", async () => {
    const created = await upload(ids.author, "membership");
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await get(ids.reader, id)).status).toBe(200);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.reader],
    );
    expect((await get(ids.reader, id)).status).toBe(404);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'student')",
      [ids.course, ids.reader],
    );
  });
  it("keeps the saved message when object storage rejects an upload", async () => {
    const failingStore = {
      send: async () => {
        throw new Error("Object store unavailable");
      },
    } as unknown as S3Client;
    const failed = await upload(
      ids.author,
      "store-failure",
      ids.archiveMessage,
      failingStore,
    );
    expect(failed.status).toBe(503);
    const saved = await pool.query<{
      body_markdown: string;
      deleted_at: Date | null;
    }>("SELECT body_markdown,deleted_at FROM thread_messages WHERE id=$1", [
      ids.archiveMessage,
    ]);
    expect(saved.rows[0]).toMatchObject({
      body_markdown: "Another message",
      deleted_at: null,
    });
  });
  it("limits a message to five live files without replacing its text", async () => {
    const before = await pool.query<{ body_markdown: string }>(
      "SELECT body_markdown FROM thread_messages WHERE id=$1",
      [ids.message],
    );
    for (let index = 0; index < 4; index++)
      expect((await upload(ids.author, `limit-${index}`)).status).toBe(201);
    const overLimit = await upload(ids.author, "limit-sixth");
    expect(overLimit.status).toBe(413);
    const after = await pool.query<{ body_markdown: string }>(
      "SELECT body_markdown FROM thread_messages WHERE id=$1",
      [ids.message],
    );
    expect(after.rows[0].body_markdown).toBe(before.rows[0].body_markdown);
  });
  it("hides message files and queues cleanup when the author deletes the message", async () => {
    const created = await upload(
      ids.author,
      "message-delete",
      ids.deleteMessage,
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const deleted = await request(app(ids.author))
      .delete(
        `/api/v1/courses/${ids.course}/threads/${ids.board}/conversations/${ids.conversation}/messages/${ids.deleteMessage}`,
      )
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"');
    expect(deleted.status).toBe(204);
    expect((await get(ids.reader, id)).status).toBe(404);
    const hidden = await pool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM thread_attachments WHERE id=$1",
      [id],
    );
    expect(hidden.rows[0].deleted_at).not.toBeNull();
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key=$1",
      [`thread-attachment-delete:${id}`],
    );
    expect(jobs.rowCount).toBe(1);
  });
  it("rejects writes on archive but allows existing member downloads", async () => {
    const created = await upload(ids.author, "second", ids.archiveMessage);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    expect((await upload(ids.author, "third", ids.archiveMessage)).status).toBe(
      409,
    );
    expect((await remove(ids.author, id)).status).toBe(409);
    expect((await get(ids.reader, id)).text).toBe("hello");
  });
  it("hides all files and queues their deletion when staff deletes a board", async () => {
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
    const active = await pool.query<{ id: string }>(
      "SELECT id FROM thread_attachments WHERE board_id=$1 AND deleted_at IS NULL",
      [ids.board],
    );
    expect(active.rows.length).toBeGreaterThan(0);
    const deleted = await request(app(ids.staff))
      .delete(`/api/v1/courses/${ids.course}/threads/${ids.board}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"');
    expect(deleted.status).toBe(204);
    expect((await get(ids.reader, active.rows[0].id)).status).toBe(404);
    const remaining = await pool.query(
      "SELECT id FROM thread_attachments WHERE board_id=$1 AND deleted_at IS NULL",
      [ids.board],
    );
    expect(remaining.rowCount).toBe(0);
    const queued = await pool.query(
      "SELECT id FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key LIKE 'thread-attachment-delete:%'",
    );
    expect(queued.rowCount).toBeGreaterThanOrEqual(active.rows.length);
  });
});
