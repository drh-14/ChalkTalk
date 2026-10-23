import { Pool } from "pg";
import { createHash } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import request from "supertest";
import {
  createObservability,
  createWorkerMetricsApp,
} from "../observability/index.js";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { JobWorker } from "./worker.js";
import { PostService, postEtag } from "../posts/service.js";
import { AnswerService, answerEtag } from "../answers/service.js";
import type { EmailSender } from "../auth/service.js";
import { CollaborationSessionService } from "../collaboration/service.js";
import { FollowupService } from "../followups/service.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `jobs_${process.pid}_${Date.now()}`;
const organizationId = "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38";
const ownerId = "01a0e5cc-58af-7467-8ab1-42c703550929";
let admin: Pool;
let pool: Pool;
let worker: JobWorker;
let sequence = 0;
const delivered: Array<{ to: string; subject: string; text: string }> = [];
let smtpFails = false;
const emailSender: EmailSender = {
  send: async (message) => {
    if (smtpFails) throw new Error("SMTP unavailable");
    delivered.push(message);
  },
};

type Seeded = { courseId: string; jobId: string };

integration("JobWorker PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'jobs.example.edu','Jobs')",
      [organizationId],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'owner@jobs.example.edu','Owner','x')",
      [ownerId, organizationId],
    );
    worker = new JobWorker(
      pool,
      "test-worker",
      emailSender,
      "https://app.example.edu",
    );
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  async function seedJob(maxAttempts = 5): Promise<Seeded> {
    sequence += 1;
    const courseId = uuidv7();
    const jobId = uuidv7();
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5)",
      [courseId, organizationId, ownerId, `Job course ${sequence}`, "ABCDEFGH"],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [courseId, ownerId],
    );
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,max_attempts,deduplication_key) VALUES ($1,'delete_course',$2,$3,$4)",
      [jobId, { courseId }, maxAttempts, `course-delete:${courseId}`],
    );
    return { courseId, jobId };
  }

  async function seedMerge(
    role: "ta" | "instructor" = "ta",
    canonicalStatus: "none" | "suggested" = "none",
  ) {
    sequence += 1;
    const authorId = uuidv7();
    const staffId = uuidv7();
    const courseId = uuidv7();
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$3,$4,'Question Author','x'),($2,$3,$5,'Ada Staff','x')",
      [
        authorId,
        staffId,
        organizationId,
        `author-${sequence}@jobs.example.edu`,
        `staff-${sequence}@jobs.example.edu`,
      ],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,'ABCDEFGH')",
      [courseId, organizationId, staffId, `Merge ${sequence}`],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,$4)",
      [courseId, authorId, staffId, role],
    );
    const posts = new PostService(pool);
    const canonical = await posts.create(courseId, authorId, {
      type: "question",
      title: "Canonical",
      bodyMarkdown: "Body",
    });
    if (canonicalStatus === "suggested") {
      const other = await posts.create(courseId, authorId, {
        type: "question",
        title: "Other",
        bodyMarkdown: "Body",
      });
      await posts.update(
        canonical.value.id,
        authorId,
        postEtag(canonical.value),
        { duplicateOfPostId: other.value.id, duplicateStatus: "suggested" },
      );
    }
    const source = await posts.create(courseId, authorId, {
      type: "question",
      title: "Why   does\n this happen?",
      bodyMarkdown: "Body",
    });
    const merged = await posts.update(
      source.value.id,
      staffId,
      postEtag(source.value),
      {
        duplicateOfPostId: canonical.value.id,
        duplicateStatus: "confirmed",
      },
    );
    const jobs = await pool.query<{ id: string }>(
      "SELECT id FROM jobs WHERE kind='send_question_duplicate_email' AND payload->>'sourcePostId'=$1",
      [source.value.id],
    );
    expect(jobs.rowCount).toBe(1);
    return {
      authorId,
      staffId,
      courseId,
      canonical,
      source,
      merged,
      jobId: jobs.rows[0]!.id,
    };
  }

  it("sends the exact question-duplicate email with a canonical link", async () => {
    delivered.length = 0;
    const { canonical, jobId } = await seedMerge();
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toEqual([
      {
        to: expect.stringMatching(/^author-\d+@jobs\.example\.edu$/),
        subject: "Your post has been marked as a duplicate",
        text: `Your question "Why does this happen?" was marked as a duplicate by Ada Staff (TA).\n\nhttps://app.example.edu/courses/${(await pool.query<{ course_id: string }>("SELECT course_id FROM posts WHERE id=$1", [canonical.value.id])).rows[0]!.course_id}/posts/${canonical.value.id}`,
      },
    ]);
    expect(
      (
        await pool.query("SELECT status,attempts FROM jobs WHERE id=$1", [
          jobId,
        ])
      ).rows,
    ).toEqual([{ status: "succeeded", attempts: 1 }]);
  });

  it("sends the email when the canonical target has a duplicate suggestion", async () => {
    delivered.length = 0;
    const { canonical, courseId, jobId, source } = await seedMerge(
      "ta",
      "suggested",
    );
    expect(
      (
        await pool.query("SELECT duplicate_status FROM posts WHERE id=$1", [
          canonical.value.id,
        ])
      ).rows[0],
    ).toEqual({ duplicate_status: "suggested" });
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toEqual([
      {
        to: expect.stringMatching(/^author-\d+@jobs\.example\.edu$/),
        subject: "Your post has been marked as a duplicate",
        text: `Your question "Why does this happen?" was marked as a duplicate by Ada Staff (TA).\n\nhttps://app.example.edu/courses/${courseId}/posts/${canonical.value.id}`,
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT duplicate_status,duplicate_of_post_id FROM posts WHERE id=$1",
          [source.value.id],
        )
      ).rows[0],
    ).toEqual({
      duplicate_status: "confirmed",
      duplicate_of_post_id: canonical.value.id,
    });
    expect(
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId]))
        .rows[0],
    ).toEqual({ status: "succeeded" });
  });

  it("retries a temporary SMTP failure without undoing the merge", async () => {
    delivered.length = 0;
    const { jobId, source } = await seedMerge("instructor");
    smtpFails = true;
    try {
      expect(await worker.runOnce()).toBe(true);
    } finally {
      smtpFails = false;
    }
    expect(delivered).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT status,attempts,last_error FROM jobs WHERE id=$1",
          [jobId],
        )
      ).rows[0],
    ).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "SMTP unavailable",
    });
    expect(
      (
        await pool.query("SELECT duplicate_status FROM posts WHERE id=$1", [
          source.value.id,
        ])
      ).rows[0],
    ).toEqual({ duplicate_status: "confirmed" });
    await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [jobId]);
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.text).toContain("Ada Staff (instructor)");
    expect(
      (
        await pool.query("SELECT status,attempts FROM jobs WHERE id=$1", [
          jobId,
        ])
      ).rows[0],
    ).toEqual({ status: "succeeded", attempts: 2 });
  });

  it("cancels a queued notification after unmerge or membership removal", async () => {
    delivered.length = 0;
    const unmerged = await seedMerge();
    await new PostService(pool).update(
      unmerged.source.value.id,
      unmerged.staffId,
      postEtag(unmerged.merged),
      {
        duplicateOfPostId: null,
        duplicateStatus: "none",
      },
    );
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toEqual([]);
    expect(
      (
        await pool.query("SELECT status FROM jobs WHERE id=$1", [
          unmerged.jobId,
        ])
      ).rows[0],
    ).toEqual({ status: "succeeded" });
    const removed = await seedMerge();
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [removed.courseId, removed.authorId],
    );
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toEqual([]);
    expect(
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [removed.jobId]))
        .rows[0],
    ).toEqual({ status: "succeeded" });
  });

  it("delivers only the new event after a question is unmerged and confirmed again", async () => {
    delivered.length = 0;
    const first = await seedMerge();
    const posts = new PostService(pool);
    const unmerged = await posts.update(
      first.source.value.id,
      first.staffId,
      postEtag(first.merged),
      { duplicateOfPostId: null, duplicateStatus: "none" },
    );
    await posts.update(
      first.source.value.id,
      first.staffId,
      postEtag(unmerged),
      {
        duplicateOfPostId: first.canonical.value.id,
        duplicateStatus: "confirmed",
      },
    );
    const jobs = await pool.query<{ id: string }>(
      "SELECT id FROM jobs WHERE kind='send_question_duplicate_email' AND payload->>'sourcePostId'=$1 ORDER BY created_at,id",
      [first.source.value.id],
    );
    expect(jobs.rowCount).toBe(2);
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toEqual([]);
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [first.jobId]))
        .rows[0],
    ).toEqual({ status: "succeeded" });
  });

  it("uses a role-only byline when the confirming staff account was deleted", async () => {
    delivered.length = 0;
    const { staffId } = await seedMerge("instructor");
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      staffId,
    ]);
    expect(await worker.runOnce()).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.text).toContain("by an instructor.");
    expect(delivered[0]!.text).not.toContain("Ada Staff");
  });

  (process.env.TEST_S3_ENDPOINT ? it : it.skip)(
    "deletes course file objects before completing course deletion",
    async () => {
      const bucket = `chalktalk-delete-test-${process.pid}-${Date.now()}`;
      const s3 = new S3Client({
        region: "us-east-1",
        endpoint: process.env.TEST_S3_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
          secretAccessKey:
            process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
        },
      });
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      try {
        const { courseId, jobId } = await seedJob();
        const resourceId = uuidv7();
        const key = `courses/${courseId}/files/${resourceId}`;
        const bytes = Buffer.from("stored original bytes");
        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }),
        );
        await pool.query(
          "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'text/plain','notes.txt',$4,$5)",
          [
            resourceId,
            courseId,
            key,
            bytes.length,
            createHash("sha256").update(bytes).digest(),
          ],
        );
        const tombstoneId = uuidv7();
        const tombstoneKey = `courses/${courseId}/files/${tombstoneId}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: tombstoneKey,
            Body: bytes,
          }),
        );
        await pool.query(
          "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256,deleted_at) VALUES ($1,$2,$3,'text/plain','old.txt',$4,$5,clock_timestamp())",
          [
            tombstoneId,
            courseId,
            tombstoneKey,
            bytes.length,
            createHash("sha256").update(bytes).digest(),
          ],
        );
        const storageWorker = new JobWorker(
          pool,
          "storage-worker",
          undefined,
          undefined,
          {
            client: s3,
            bucket,
          },
        );
        expect(await storageWorker.runOnce()).toBe(true);
        expect(
          (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId]))
            .rows[0].status,
        ).toBe("succeeded");
        expect(
          (
            await pool.query("SELECT 1 FROM course_files WHERE id=$1", [
              resourceId,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await s3.send(new ListObjectsV2Command({ Bucket: bucket })))
            .Contents ?? [],
        ).toHaveLength(0);
      } finally {
        const objects = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket }),
        );
        for (const object of objects.Contents ?? [])
          if (object.Key)
            await s3.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
            );
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        s3.destroy();
      }
    },
  );
  it("retains course metadata and retries when object deletion fails", async () => {
    const { courseId, jobId } = await seedJob();
    const resourceId = uuidv7();
    const bytes = Buffer.from("stored original bytes");
    await pool.query(
      "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'text/plain','notes.txt',$4,$5)",
      [
        resourceId,
        courseId,
        `courses/${courseId}/files/${resourceId}`,
        bytes.length,
        createHash("sha256").update(bytes).digest(),
      ],
    );
    const failingStore = {
      send: async () => {
        throw new Error("object storage unavailable");
      },
    } as unknown as S3Client;
    const storageWorker = new JobWorker(
      pool,
      "failing-storage-worker",
      undefined,
      undefined,
      {
        client: failingStore,
        bucket: "unused",
      },
    );
    expect(await storageWorker.runOnce()).toBe(true);
    expect(
      (
        await pool.query("SELECT status,last_error FROM jobs WHERE id=$1", [
          jobId,
        ])
      ).rows[0],
    ).toMatchObject({
      status: "queued",
      last_error: "object storage unavailable",
    });
    expect(
      (await pool.query("SELECT 1 FROM course_files WHERE id=$1", [resourceId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]))
        .rowCount,
    ).toBe(1);
  });
  it("retries a durable file-delete job without restoring visibility", async () => {
    const { courseId, jobId: courseJobId } = await seedJob();
    await pool.query("DELETE FROM jobs WHERE id=$1", [courseJobId]);
    const fileId = uuidv7();
    const objectKey = `courses/${courseId}/files/${fileId}`;
    const bytes = Buffer.from("original bytes");
    await pool.query(
      "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256,deleted_at) VALUES ($1,$2,$3,'text/plain','old.txt',$4,$5,clock_timestamp())",
      [
        fileId,
        courseId,
        objectKey,
        bytes.length,
        createHash("sha256").update(bytes).digest(),
      ],
    );
    const jobId = uuidv7();
    await pool.query(
      "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_course_file',$2,$3)",
      [jobId, { courseId, fileId, objectKey }, `file-delete:${fileId}`],
    );
    const failed = new JobWorker(
      pool,
      "failed-file-delete",
      undefined,
      undefined,
      {
        client: {
          send: async () => {
            throw new Error("storage offline");
          },
        } as unknown as S3Client,
        bucket: "unused",
      },
    );
    expect(await failed.runOnce()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT status,attempts,last_error FROM jobs WHERE id=$1",
          [jobId],
        )
      ).rows[0],
    ).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "storage offline",
    });
    expect(
      (
        await pool.query("SELECT deleted_at FROM course_files WHERE id=$1", [
          fileId,
        ])
      ).rows[0].deleted_at,
    ).toBeTruthy();
    await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [jobId]);
    const removed: string[] = [];
    const recovered = new JobWorker(
      pool,
      "recovered-file-delete",
      undefined,
      undefined,
      {
        client: {
          send: async (command: DeleteObjectCommand) => {
            removed.push(command.input.Key!);
            return {};
          },
        } as unknown as S3Client,
        bucket: "unused",
      },
    );
    expect(await recovered.runOnce()).toBe(true);
    expect(removed).toEqual([objectKey]);
    expect(
      (
        await pool.query("SELECT status,attempts FROM jobs WHERE id=$1", [
          jobId,
        ])
      ).rows[0],
    ).toMatchObject({ status: "succeeded", attempts: 2 });
  });
  it("includes an upload committed while course deletion waits for its lock", async () => {
    const { courseId, jobId } = await seedJob();
    const resourceId = uuidv7();
    const key = `courses/${courseId}/files/${resourceId}`;
    const bytes = Buffer.from("concurrent upload");
    const uploader = await pool.connect();
    const deleted: string[] = [];
    const store = {
      send: async (command: DeleteObjectCommand) => {
        deleted.push(command.input.Key!);
        return {};
      },
    } as unknown as S3Client;
    try {
      await uploader.query("BEGIN");
      const uploaderPid = (
        await uploader.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await uploader.query(
        "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'text/plain','notes.txt',$4,$5)",
        [
          resourceId,
          courseId,
          key,
          bytes.length,
          createHash("sha256").update(bytes).digest(),
        ],
      );
      const deleting = new JobWorker(
        pool,
        "concurrent-delete-worker",
        undefined,
        undefined,
        {
          client: store,
          bucket: "unused",
        },
      ).runOnce();
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
          [uploaderPid],
        );
        blocked = state.rows[0]!.blocked;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await uploader.query("COMMIT");
      expect(blocked).toBe(true);
      expect(await deleting).toBe(true);
      expect(deleted).toEqual([key]);
      expect(
        (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId]))
          .rows[0].status,
      ).toBe("succeeded");
    } finally {
      await uploader.query("ROLLBACK").catch(() => {});
      uploader.release();
    }
  });
  it("persists a failed cleanup attempt, then retries it successfully", async () => {
    const { courseId, jobId } = await seedJob();
    await pool.query(`
      CREATE FUNCTION fail_course_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced delete failure'; END;
      $$;
      CREATE TRIGGER fail_course_delete BEFORE DELETE ON courses
      FOR EACH ROW EXECUTE FUNCTION fail_course_delete();
    `);

    await expect(worker.runOnce()).resolves.toBe(true);
    const failed = await pool.query<{
      status: string;
      attempts: number;
      available_at: Date;
      locked_until: Date | null;
      last_error: string | null;
    }>(
      "SELECT status,attempts,available_at,locked_until,last_error FROM jobs WHERE id=$1",
      [jobId],
    );
    expect(failed.rows[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      locked_until: null,
    });
    expect(failed.rows[0]!.available_at.getTime()).toBeGreaterThan(
      Date.now() - 50,
    );
    expect(failed.rows[0]!.last_error).toContain("forced delete failure");
    expect(
      await pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]),
    ).toMatchObject({ rowCount: 1 });

    await pool.query(
      "DROP TRIGGER fail_course_delete ON courses; DROP FUNCTION fail_course_delete()",
    );
    await pool.query("UPDATE jobs SET available_at=now() WHERE id=$1", [jobId]);
    await expect(worker.runOnce()).resolves.toBe(true);
    await expect(
      pool.query("SELECT status,attempts,last_error FROM jobs WHERE id=$1", [
        jobId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ status: "succeeded", attempts: 2, last_error: null }],
    });
    await expect(
      pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it("dead-letters a job when its maximum attempts are exhausted", async () => {
    const { courseId, jobId } = await seedJob(1);
    await pool.query(`
      CREATE FUNCTION always_fail_course_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'permanent delete failure'; END;
      $$;
      CREATE TRIGGER always_fail_course_delete BEFORE DELETE ON courses
      FOR EACH ROW EXECUTE FUNCTION always_fail_course_delete();
    `);

    await expect(worker.runOnce()).resolves.toBe(true);
    await expect(
      pool.query(
        "SELECT status,attempts,finished_at,last_error FROM jobs WHERE id=$1",
        [jobId],
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          status: "dead",
          attempts: 1,
          last_error: expect.stringContaining("permanent delete failure"),
        }),
      ],
    });
    await expect(
      pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await pool.query(
      "DROP TRIGGER always_fail_course_delete ON courses; DROP FUNCTION always_fail_course_delete()",
    );
  });

  it("reclaims an expired lease after a worker restart and treats an already absent course as complete", async () => {
    const recovered = await seedJob();
    await pool.query(
      "UPDATE jobs SET status='running',attempts=1,locked_by='crashed',locked_until=now()-interval '1 minute' WHERE id=$1",
      [recovered.jobId],
    );
    await expect(worker.runOnce()).resolves.toBe(true);
    await expect(
      pool.query("SELECT status,attempts,locked_until FROM jobs WHERE id=$1", [
        recovered.jobId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ status: "succeeded", attempts: 2, locked_until: null }],
    });

    const absent = await seedJob();
    await pool.query("DELETE FROM course_memberships WHERE course_id=$1", [
      absent.courseId,
    ]);
    await pool.query("DELETE FROM courses WHERE id=$1", [absent.courseId]);
    await expect(worker.runOnce()).resolves.toBe(true);
    await expect(
      pool.query("SELECT status,attempts FROM jobs WHERE id=$1", [
        absent.jobId,
      ]),
    ).resolves.toMatchObject({ rows: [{ status: "succeeded", attempts: 1 }] });
  });

  it("does not claim one queued job twice when runs overlap", async () => {
    const { jobId } = await seedJob();
    const outcomes = await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(outcomes.sort()).toEqual([false, true]);
    await expect(
      pool.query("SELECT status,attempts FROM jobs WHERE id=$1", [jobId]),
    ).resolves.toMatchObject({ rows: [{ status: "succeeded", attempts: 1 }] });
  });
  it("removes a course's posts and tags before removing the course", async () => {
    const { courseId, jobId } = await seedJob();
    const service = new PostService(pool);
    const post = await service.create(courseId, ownerId, {
      type: "question",
      title: "Question",
      bodyMarkdown: "Body",
      tags: ["cleanup"],
    });
    expect(post.value.id).toBeDefined();
    const duplicate = await service.create(courseId, ownerId, {
      type: "note",
      title: "Duplicate",
      bodyMarkdown: "Body",
      tags: ["cleanup"],
    });
    await service.update(
      duplicate.value.id,
      ownerId,
      postEtag(duplicate.value),
      {
        duplicateOfPostId: post.value.id,
        duplicateStatus: "confirmed",
      },
    );
    await expect(worker.runOnce()).resolves.toBe(true);
    const job = await pool.query("SELECT status FROM jobs WHERE id=$1", [
      jobId,
    ]);
    expect(job.rows[0].status).toBe("succeeded");
    expect(
      (await pool.query("SELECT 1 FROM posts WHERE course_id=$1", [courseId]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT 1 FROM tags WHERE course_id=$1", [courseId]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT 1 FROM courses WHERE id=$1", [courseId]))
        .rowCount,
    ).toBe(0);
  });
  it("removes a course's answers before its posts", async () => {
    const { courseId, jobId } = await seedJob();
    const post = await new PostService(pool).create(courseId, ownerId, {
      type: "question",
      title: "Answered",
      bodyMarkdown: "Body",
    });
    const answers = new AnswerService(pool);
    const kept = await answers.create(post.value.id, ownerId, {
      bodyMarkdown: "Staff answer",
    });
    await answers.endorse(kept.value.id, ownerId, answerEtag(kept.value));
    const other = await new PostService(pool).create(courseId, ownerId, {
      type: "question",
      title: "Deleted answer",
      bodyMarkdown: "Body",
    });
    const removed = await answers.create(other.value.id, ownerId, {
      bodyMarkdown: "Removed",
    });
    await answers.delete(removed.value.id, ownerId, answerEtag(removed.value));
    await new PostService(pool).get(post.value.id, ownerId);
    await expect(worker.runOnce()).resolves.toBe(true);
    const job = await pool.query("SELECT status FROM jobs WHERE id=$1", [
      jobId,
    ]);
    expect(job.rows[0].status).toBe("succeeded");
    const left = await pool.query(
      "SELECT (SELECT count(*) FROM answers WHERE course_id=$1)::int AS answers,(SELECT count(*) FROM answer_contributors WHERE answer_id IN ($2,$3))::int AS contributors,(SELECT count(*) FROM post_view_events WHERE course_id=$1)::int AS views,(SELECT count(*) FROM answer_contribution_events WHERE course_id=$1)::int AS events,(SELECT count(*) FROM question_creation_daily_counts WHERE course_id=$1)::int AS question_counts,(SELECT count(*) FROM courses WHERE id=$1)::int AS courses",
      [courseId, kept.value.id, removed.value.id],
    );
    expect(left.rows[0]).toEqual({
      answers: 0,
      contributors: 0,
      views: 0,
      events: 0,
      question_counts: 0,
      courses: 0,
    });
  });
  it("records a sanitized start and outcome for a claimed job", async () => {
    const { jobId } = await seedJob();
    const events: string[] = [];
    const observability = createObservability({
      token: "job-test-operator-token-long-enough",
      stdout: (line) => events.push(line),
    });
    await new JobWorker(
      pool,
      "instrumented-worker",
      undefined,
      undefined,
      undefined,
      observability,
    ).runOnce();
    expect(
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId])).rows[0]
        .status,
    ).toBe("succeeded");
    expect(events.join("\n")).toContain('"event":"job_start"');
    expect(events.join("\n")).toContain('"event":"job_outcome"');
    expect(events.join("\n")).not.toContain(jobId);
    const metrics = await request(createWorkerMetricsApp(observability))
      .get("/metrics")
      .set("Authorization", "Bearer job-test-operator-token-long-enough");
    expect(metrics.text).toContain(
      'chalktalk_jobs_total{kind="delete_course",outcome="succeeded"} 1',
    );
    await observability.close();
  });

  it("labels duplicate-email job metrics with their own job kind", async () => {
    const { jobId } = await seedMerge();
    const events: string[] = [];
    const observability = createObservability({
      token: "job-test-operator-token-long-enough",
      stdout: (line) => events.push(line),
    });
    await new JobWorker(
      pool,
      "instrumented-email-worker",
      emailSender,
      "https://app.example.edu",
      undefined,
      observability,
    ).runOnce();
    expect(
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId])).rows[0]
        .status,
    ).toBe("succeeded");
    expect(events.join("\n")).toContain(
      '"event":"job_start","kind":"send_question_duplicate_email"',
    );
    const metrics = await request(createWorkerMetricsApp(observability))
      .get("/metrics")
      .set("Authorization", "Bearer job-test-operator-token-long-enough");
    expect(metrics.text).toContain(
      'chalktalk_jobs_total{kind="send_question_duplicate_email",outcome="succeeded"} 1',
    );
    await observability.close();
  });

  describe("live session invitation email", () => {
    // Jobs left by earlier tests would otherwise be claimed first.
    async function fresh() {
      while (await worker.runOnce());
      delivered.length = 0;
    }
    async function seedInvitation() {
      sequence += 1;
      const studentId = uuidv7();
      const taId = uuidv7();
      const courseId = uuidv7();
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$3,$4,'Sam   Student','x'),($2,$3,$5,'Tara TA','x')",
        [
          studentId,
          taId,
          organizationId,
          `student-${sequence}@jobs.example.edu`,
          `ta-${sequence}@jobs.example.edu`,
        ],
      );
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,'ABCDEFGH')",
        [courseId, organizationId, taId, `CS ${sequence}`],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role,activity_emails) VALUES ($1,$2,'student',true),($1,$3,'ta',false)",
        [courseId, studentId, taId],
      );
      const post = await new PostService(pool).create(courseId, studentId, {
        type: "question",
        title: "Loops",
        bodyMarkdown: "Body",
      });
      const sessions = new CollaborationSessionService(pool, {
        webSocketUrl: "wss://app.example.edu/collaboration",
      });
      const session = (
        await sessions.create(courseId, studentId, {
          postId: post.value.id,
          title: "Why does my\nloop never stop?",
        })
      ).value;
      await sessions.invite(session.id, studentId, taId);
      const jobs = await pool.query<{ id: string }>(
        "SELECT id FROM jobs WHERE kind='send_collaboration_invitation_email' AND payload->>'sessionId'=$1",
        [session.id],
      );
      expect(jobs.rowCount).toBe(1);
      return {
        courseId,
        studentId,
        taId,
        sessionId: session.id,
        sessions,
        jobId: jobs.rows[0]!.id,
      };
    }
    const status = async (jobId: string) =>
      (await pool.query("SELECT status FROM jobs WHERE id=$1", [jobId])).rows[0]
        ?.status;

    it("emails the invitee who invited them, to what, and a link", async () => {
      await fresh();
      const { courseId, sessionId, jobId } = await seedInvitation();
      expect(await worker.runOnce()).toBe(true);
      expect(delivered).toEqual([
        {
          to: `ta-${sequence}@jobs.example.edu`,
          subject: "Sam Student invited you to a live session",
          text: `Sam Student invited you to the live session "Why does my loop never stop?" in CS ${sequence}.\n\nhttps://app.example.edu/courses/${courseId}/sessions/${sessionId}\n\nTo open it, you need access to the post and either an invitation or a course staff role.`,
        },
      ]);
      expect(await status(jobId)).toBe("succeeded");
    });

    it("holds group access until an invitation email is sent", async () => {
      await fresh();
      const seeded = await seedInvitation();
      const post = await pool.query<{ post_id: string }>(
        "SELECT post_id FROM collaboration_sessions WHERE id=$1",
        [seeded.sessionId],
      );
      const groupId = uuidv7();
      await pool.query(
        "INSERT INTO private_post_groups(id,course_id,name) VALUES ($1,$2,'Invitation group')",
        [groupId, seeded.courseId],
      );
      for (const userId of [seeded.studentId, seeded.taId])
        await pool.query(
          "INSERT INTO private_post_group_members(group_id,course_id,user_id) VALUES ($1,$2,$3)",
          [groupId, seeded.courseId, userId],
        );
      await pool.query(
        "UPDATE posts SET audience='group',audience_group_id=$2,private=true WHERE id=$1",
        [post.rows[0]!.post_id, groupId],
      );
      let sending!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (sending = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      const slowWorker = new JobWorker(
        pool,
        "held-invitation-audience",
        {
          send: async (message) => {
            sending();
            await held;
            delivered.push(message);
          },
        },
        "https://app.example.edu",
      );
      const delivery = slowWorker.runOnce();
      await started;
      let revoked = false;
      const revocation = pool
        .query(
          "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
          [groupId, seeded.taId],
        )
        .then(() => (revoked = true));
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(revoked).toBe(false);
      } finally {
        release();
        await delivery;
        await revocation;
      }
      expect(delivered).toHaveLength(1);
    });

    it("sends nothing once the invitation no longer stands", async () => {
      await fresh();
      const removed = await seedInvitation();
      await removed.sessions.remove(
        removed.sessionId,
        removed.studentId,
        removed.taId,
      );
      const ended = await seedInvitation();
      await pool.query(
        "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=now() WHERE id=$1",
        [ended.sessionId],
      );
      const archived = await seedInvitation();
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        archived.courseId,
      ]);
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
      for (const { jobId } of [removed, ended, archived])
        expect(await status(jobId)).toBe("succeeded");
    });

    it("does not send a stale job for an earlier invitation of the same member", async () => {
      await fresh();
      const first = await seedInvitation();
      await first.sessions.remove(first.sessionId, first.studentId, first.taId);
      await first.sessions.invite(first.sessionId, first.studentId, first.taId);
      while (await worker.runOnce());
      expect(delivered).toHaveLength(1);
    });
  });

  describe("announcement email", () => {
    async function fresh() {
      while (await worker.runOnce());
      delivered.length = 0;
    }
    async function seedAnnouncement(body = "Thursday 3pm instead.") {
      sequence += 1;
      const instructorId = uuidv7();
      const studentId = uuidv7();
      const courseId = uuidv7();
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$3,$4,'Ina   Instructor','x'),($2,$3,$5,'Sam Student','x')",
        [
          instructorId,
          studentId,
          organizationId,
          `ina-${sequence}@jobs.example.edu`,
          `sam-${sequence}@jobs.example.edu`,
        ],
      );
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,'ABCDEFGH')",
        [courseId, organizationId, instructorId, `Physics ${sequence}`],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor'),($1,$3,'student')",
        [courseId, instructorId, studentId],
      );
      const post = await new PostService(pool).create(courseId, instructorId, {
        type: "note",
        title: "Office  hours moved",
        bodyMarkdown: body,
        announcement: true,
      });
      return { courseId, instructorId, studentId, postId: post.value.id };
    }

    it("emails each other member the announcement with a link", async () => {
      await fresh();
      const { courseId, postId } = await seedAnnouncement();
      while (await worker.runOnce());
      expect(delivered).toEqual([
        {
          to: `sam-${sequence}@jobs.example.edu`,
          subject: `[Physics ${sequence}] Office hours moved`,
          text: `Ina Instructor posted an announcement in Physics ${sequence}:\n\nOffice hours moved\n\nThursday 3pm instead.\n\nhttps://app.example.edu/courses/${courseId}/posts/${postId}`,
        },
      ]);
    });

    it("does not block announcement opt-out during SMTP delivery", async () => {
      await fresh();
      const seeded = await seedAnnouncement();
      let sending!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        sending = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slowWorker = new JobWorker(
        pool,
        "held-announcement_emails",
        {
          send: async (message) => {
            sending();
            await held;
            delivered.push(message);
          },
        },
        "https://app.example.edu",
      );
      const delivery = slowWorker.runOnce();
      await started;
      const optOut = pool.query(
        "UPDATE course_memberships SET announcement_emails=false WHERE course_id=$1 AND user_id=$2",
        [seeded.courseId, seeded.studentId],
      );
      const completedEarly = await Promise.race([
        optOut.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1_000),
        ),
      ]);
      release();
      await delivery;
      await optOut;
      expect(completedEarly).toBe(true);
      expect(delivered).toHaveLength(1);
    });

    it("honors announcement opt-out after queueing", async () => {
      await fresh();
      const seeded = await seedAnnouncement();
      await pool.query(
        "UPDATE course_memberships SET announcement_emails=false WHERE course_id=$1 AND user_id=$2",
        [seeded.courseId, seeded.studentId],
      );
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
    });

    it("truncates a long body", async () => {
      await fresh();
      await seedAnnouncement("a".repeat(2_500));
      while (await worker.runOnce());
      expect(delivered[0]!.text).toContain(`${"a".repeat(2_000)}…\n\n`);
      expect(delivered[0]!.text).not.toContain("a".repeat(2_001));
    });

    it("sends nothing once the announcement or recipient no longer qualifies", async () => {
      await fresh();
      const deleted = await seedAnnouncement();
      await pool.query(
        "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
        [deleted.postId],
      );
      const archived = await seedAnnouncement();
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        archived.courseId,
      ]);
      const left = await seedAnnouncement();
      await pool.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [left.courseId, left.studentId],
      );
      const gone = await seedAnnouncement();
      await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
        gone.studentId,
      ]);
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
    });
  });

  describe("notification email", () => {
    async function fresh() {
      while (await worker.runOnce());
      delivered.length = 0;
    }
    // A TA answers an opted-in student's question.
    async function seedAnswered() {
      sequence += 1;
      const studentId = uuidv7();
      const taId = uuidv7();
      const courseId = uuidv7();
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash,notification_emails) VALUES ($1,$3,$4,'Sam Student','x',true),($2,$3,$5,'Tara   TA','x',false)",
        [
          studentId,
          taId,
          organizationId,
          `sam-n-${sequence}@jobs.example.edu`,
          `tara-n-${sequence}@jobs.example.edu`,
        ],
      );
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,'ABCDEFGH')",
        [courseId, organizationId, taId, `Biology ${sequence}`],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role,activity_emails) VALUES ($1,$2,'student',true),($1,$3,'ta',false)",
        [courseId, studentId, taId],
      );
      const post = await new PostService(pool).create(courseId, studentId, {
        type: "question",
        title: "Mitosis  phases",
        bodyMarkdown: "Which comes first?",
      });
      const postId = post.value.id;
      await new AnswerService(pool).create(postId, taId, {
        bodyMarkdown: "Prophase.",
      });
      return { courseId, studentId, taId, postId };
    }

    it("emails the follower who opted in, naming the actor and linking the post", async () => {
      await fresh();
      const { courseId, postId } = await seedAnswered();
      while (await worker.runOnce());
      expect(delivered).toEqual([
        {
          to: `sam-n-${sequence}@jobs.example.edu`,
          subject: `[Biology ${sequence}] New answer on "Mitosis phases"`,
          text: `Tara TA answered "Mitosis phases" in Biology ${sequence}.

https://app.example.edu/courses/${courseId}/posts/${postId}

To stop these emails, turn off "Activity emails on followed posts" in this course's settings.`,
        },
      ]);
    });

    it("holds group access until a notification email is sent", async () => {
      await fresh();
      const seeded = await seedAnswered();
      const groupId = uuidv7();
      await pool.query(
        "INSERT INTO private_post_groups(id,course_id,name) VALUES ($1,$2,'Notification group')",
        [groupId, seeded.courseId],
      );
      for (const userId of [seeded.studentId, seeded.taId])
        await pool.query(
          "INSERT INTO private_post_group_members(group_id,course_id,user_id) VALUES ($1,$2,$3)",
          [groupId, seeded.courseId, userId],
        );
      await pool.query(
        "UPDATE posts SET audience='group',audience_group_id=$2,private=true WHERE id=$1",
        [seeded.postId, groupId],
      );
      let sending!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (sending = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      const slowWorker = new JobWorker(
        pool,
        "held-notification-audience",
        {
          send: async (message) => {
            sending();
            await held;
            delivered.push(message);
          },
        },
        "https://app.example.edu",
      );
      const delivery = slowWorker.runOnce();
      await started;
      let revoked = false;
      const revocation = pool
        .query(
          "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
          [groupId, seeded.studentId],
        )
        .then(() => (revoked = true));
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(revoked).toBe(false);
      } finally {
        release();
        await delivery;
        await revocation;
      }
      expect(delivered).toHaveLength(1);
    });

    it("does not block activity opt-out during SMTP delivery", async () => {
      await fresh();
      const seeded = await seedAnswered();
      let sending!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        sending = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slowWorker = new JobWorker(
        pool,
        "held-activity_emails",
        {
          send: async (message) => {
            sending();
            await held;
            delivered.push(message);
          },
        },
        "https://app.example.edu",
      );
      const delivery = slowWorker.runOnce();
      await started;
      const optOut = pool.query(
        "UPDATE course_memberships SET activity_emails=false WHERE course_id=$1 AND user_id=$2",
        [seeded.courseId, seeded.studentId],
      );
      const completedEarly = await Promise.race([
        optOut.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1_000),
        ),
      ]);
      release();
      await delivery;
      await optOut;
      expect(completedEarly).toBe(true);
      expect(delivered).toHaveLength(1);
    });

    it("honors activity opt-out after queueing", async () => {
      await fresh();
      const seeded = await seedAnswered();
      await pool.query(
        "UPDATE course_memberships SET activity_emails=false WHERE course_id=$1 AND user_id=$2",
        [seeded.courseId, seeded.studentId],
      );
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
    });

    it("hides an anonymous actor and words each kind", async () => {
      await fresh();
      const { postId, taId, studentId } = await seedAnswered();
      while (await worker.runOnce());
      delivered.length = 0;
      // The TA follows too, so the student's anonymous followup reaches them.
      await pool.query(
        "UPDATE course_memberships SET activity_emails=true WHERE user_id=$1",
        [taId],
      );
      await new FollowupService(pool).create(postId, studentId, {
        bodyMarkdown: "Why?",
        anonymous: true,
      });
      while (await worker.runOnce());
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.subject).toBe(
        `[Biology ${sequence}] New followup on "Mitosis phases"`,
      );
      expect(delivered[0]!.text).toMatch(
        /^Someone posted a followup on "Mitosis phases" in Biology/,
      );
    });

    it("emails a mentioned follower once, as a mention", async () => {
      await fresh();
      const { courseId, postId, studentId, taId } = await seedAnswered();
      while (await worker.runOnce());
      delivered.length = 0;
      await new FollowupService(pool).create(postId, taId, {
        bodyMarkdown: `[@Sam](mention:${studentId}) does this help?`,
      });
      while (await worker.runOnce());
      expect(delivered).toEqual([
        {
          to: `sam-n-${sequence}@jobs.example.edu`,
          subject: `[Biology ${sequence}] You were mentioned on "Mitosis phases"`,
          text: `Tara TA mentioned you on "Mitosis phases" in Biology ${sequence}.

https://app.example.edu/courses/${courseId}/posts/${postId}

To stop these emails, turn off "Activity emails on followed posts" in this course's settings.`,
        },
      ]);
    });

    it("emails the author when staff make their private post public", async () => {
      await fresh();
      const { courseId, postId, taId } = await seedAnswered();
      while (await worker.runOnce());
      delivered.length = 0;
      await pool.query("UPDATE posts SET private=true WHERE id=$1", [postId]);
      const posts = new PostService(pool);
      const current = await posts.get(postId, taId);
      await posts.update(
        postId,
        taId,
        postEtag(current as { version: number }),
        {
          private: false,
        },
      );
      while (await worker.runOnce());
      expect(delivered).toEqual([
        {
          to: `sam-n-${sequence}@jobs.example.edu`,
          subject: `[Biology ${sequence}] Your post is now public: "Mitosis phases"`,
          text: `Tara TA made your post public: "Mitosis phases" in Biology ${sequence}.

https://app.example.edu/courses/${courseId}/posts/${postId}

To stop these emails, turn off "Activity emails on followed posts" in this course's settings.`,
        },
      ]);
    });

    it("sends nothing to a recipient who can no longer read a private post", async () => {
      await fresh();
      const { courseId, postId, taId } = await seedAnswered();
      while (await worker.runOnce());
      delivered.length = 0;
      await pool.query("UPDATE posts SET private=true WHERE id=$1", [postId]);
      await pool.query(
        "UPDATE course_memberships SET activity_emails=true WHERE user_id=$1",
        [taId],
      );
      // The TA was notified, then demoted before the email went out.
      const notification = await pool.query<{ id: string }>(
        "INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'followup_created',$1) RETURNING id",
        [taId, courseId, postId],
      );
      const id = notification.rows[0]!.id;
      await pool.query(
        "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES (gen_random_uuid(),'send_notification_email',$1,$2)",
        [{ notificationId: id }, id],
      );
      await pool.query(
        "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
        [courseId, taId],
      );
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
    });

    it("sends nothing once the notification, post, or recipient no longer qualifies", async () => {
      await fresh();
      const read = await seedAnswered();
      await pool.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1",
        [read.studentId],
      );
      const optedOut = await seedAnswered();
      await pool.query(
        "UPDATE course_memberships SET activity_emails=false WHERE user_id=$1",
        [optedOut.studentId],
      );
      const left = await seedAnswered();
      await pool.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [left.courseId, left.studentId],
      );
      const deleted = await seedAnswered();
      await pool.query(
        "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
        [deleted.postId],
      );
      const gone = await seedAnswered();
      await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
        gone.studentId,
      ]);
      while (await worker.runOnce());
      expect(delivered).toEqual([]);
    });
  });
});
