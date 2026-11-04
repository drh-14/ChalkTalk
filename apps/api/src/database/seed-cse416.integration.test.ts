import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";
import { AMS161_DEMO, seedAms161 } from "./seed-ams161.js";
import { CSE416_DEMO, seedCse416 } from "./seed-cse416.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `cse416_seed_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const enabled = {
  MOCK_DATA: "true",
  AMS161_DEMO_INSTRUCTOR_PASSWORD: "local demo password 123",
};

integration("CSE 416 demo seed", () => {
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
        "SELECT count(*)::int AS count FROM courses WHERE id=$1",
        [CSE416_DEMO.courseId],
      )
    ).rows[0].count;

  it("imports nothing when mock data is disabled", async () => {
    expect(
      await seedCse416(
        pool,
        { MOCK_DATA: "false" },
        AMS161_DEMO.instructorEmail,
      ),
    ).toBe("disabled");
    expect(await courseCount()).toBe(0);
  });

  it("rejects an invalid imported-account password before writing", async () => {
    await seedAms161(pool, enabled);
    await expect(
      seedCse416(
        pool,
        { ...enabled, PIAZZA_DEMO_PASSWORD: "short" },
        AMS161_DEMO.instructorEmail,
      ),
    ).rejects.toThrow(/PIAZZA_DEMO_PASSWORD/);
    expect(await courseCount()).toBe(0);
  });

  it("creates CSE 416 for the demo instructor with its imported posts", async () => {
    expect(await seedCse416(pool, enabled, AMS161_DEMO.instructorEmail)).toBe(
      "created",
    );
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
    expect(await seedCse416(pool, enabled, AMS161_DEMO.instructorEmail)).toBe(
      "already-seeded",
    );
    const edited = await pool.query(
      "SELECT body_markdown FROM posts WHERE course_id=$1 AND title='M3 grade distribution'",
      [CSE416_DEMO.courseId],
    );
    expect(edited.rows[0].body_markdown).toBe("Edited locally");
  });
});
