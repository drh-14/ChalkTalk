import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";
import { AMS161_DEMO, seedAms161 } from "./seed-ams161.js";
import {
  CSE214_DEMO,
  CSE416_DEMO,
  seedPiazzaCourses,
} from "./seed-piazza-courses.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `piazza_seed_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const enabled = {
  MOCK_DATA: "true",
  AMS161_DEMO_INSTRUCTOR_PASSWORD: "local demo password 123",
};

const seed = (source: Record<string, string>) =>
  seedPiazzaCourses(pool, source, AMS161_DEMO.instructorEmail);

integration("Piazza demo course seed", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  const courseCount = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM courses WHERE id = ANY($1)",
        [[CSE416_DEMO.courseId, CSE214_DEMO.courseId]],
      )
    ).rows[0].count;

  it("imports nothing when mock data is disabled", async () => {
    expect(await seed({ MOCK_DATA: "false" })).toBe("disabled");
    expect(await courseCount()).toBe(0);
  });

  it("rejects an invalid imported-account password before writing", async () => {
    await seedAms161(pool, enabled);
    await expect(
      seed({ ...enabled, PIAZZA_DEMO_PASSWORD: "short" }),
    ).rejects.toThrow(/PIAZZA_DEMO_PASSWORD/);
    expect(await courseCount()).toBe(0);
  });

  it("creates CSE 416 and CSE 214 for the demo instructor with their imported posts", async () => {
    expect(await seed(enabled)).toEqual([
      { label: "CSE 416", result: "created" },
      { label: "CSE 214", result: "created" },
    ]);
    const cse214 = await pool.query(
      `SELECT c.name, m.role,
              (SELECT count(*)::int FROM posts p WHERE p.course_id=c.id) AS posts
       FROM courses c
       JOIN course_memberships m ON m.course_id=c.id
       JOIN users u ON u.id=m.user_id AND u.email=$2
       WHERE c.id=$1`,
      [CSE214_DEMO.courseId, AMS161_DEMO.instructorEmail],
    );
    expect(cse214.rows[0]).toMatchObject({
      name: "CSE 214-01 Data Structures",
      role: "instructor",
    });
    expect(cse214.rows[0].posts).toBeGreaterThan(0);
    const course = await pool.query(
      "SELECT name, organization_id FROM courses WHERE id=$1",
      [CSE416_DEMO.courseId],
    );
    expect(course.rows[0]).toEqual({
      name: "CSE 416-03 Software Engineering",
      organization_id: AMS161_DEMO.organizationId,
    });
    const role = await pool.query(
      `SELECT m.role FROM course_memberships m JOIN users u ON u.id=m.user_id
       WHERE m.course_id=$1 AND u.email=$2`,
      [CSE416_DEMO.courseId, AMS161_DEMO.instructorEmail],
    );
    expect(role.rows[0]?.role).toBe("instructor");
    const posts = await pool.query<{ title: string; body: string }>(
      "SELECT title, body_markdown AS body FROM posts WHERE course_id=$1 AND deleted_at IS NULL",
      [CSE416_DEMO.courseId],
    );
    expect(posts.rows.length).toBeGreaterThanOrEqual(20);
    expect(
      posts.rows.find((post) => post.title === "M3 grade distribution")?.body,
    ).toContain("| Instructor | 7 | 6 | 1 | 0 | 0 |");
  });

  it("leaves an existing CSE 416 and its local edits alone", async () => {
    await pool.query(
      "UPDATE posts SET body_markdown='Edited locally' WHERE course_id=$1 AND title='M3 grade distribution'",
      [CSE416_DEMO.courseId],
    );
    expect(await seed(enabled)).toEqual([
      { label: "CSE 416", result: "already-seeded" },
      { label: "CSE 214", result: "already-seeded" },
    ]);
    const edited = await pool.query(
      "SELECT body_markdown FROM posts WHERE course_id=$1 AND title='M3 grade distribution'",
      [CSE416_DEMO.courseId],
    );
    expect(edited.rows[0].body_markdown).toBe("Edited locally");
  });
});
