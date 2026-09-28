import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { JobWorker } from "./worker.js";
import { PostService, postEtag } from "../posts/service.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `jobs_${process.pid}_${Date.now()}`;
const organizationId = "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38";
const ownerId = "01a0e5cc-58af-7467-8ab1-42c703550929";
let admin: Pool;
let pool: Pool;
let worker: JobWorker;
let sequence = 0;

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
    worker = new JobWorker(pool, "test-worker");
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
});
