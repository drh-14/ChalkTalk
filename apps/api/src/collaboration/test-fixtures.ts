import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";

export type FixtureRole = "student" | "ta" | "instructor";

/** An isolated, fully migrated schema for one collaboration test file. */
export async function createTestSchema(url: string, label: string) {
  const schema = `${label}_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: url,
    options: `--search_path="${schema}"`,
  });
  await runMigrations(pool, getMigrationDirectory());
  return {
    schema,
    pool,
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

/** Inserts an organization, a course with the given members, and one post. */
export async function seedCourse(
  pool: Pool,
  members: Record<string, FixtureRole>,
  options: { status?: "active" | "archived" } = {},
) {
  const organizationId = uuidv7();
  const domain = `${organizationId.slice(-8)}.example.edu`;
  await pool.query(
    "INSERT INTO organizations (id, domain, name) VALUES ($1, $2, 'Example')",
    [organizationId, domain],
  );
  const users: Record<string, string> = {};
  for (const name of Object.keys(members)) {
    users[name] = uuidv7();
    await pool.query(
      "INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, 'x')",
      [users[name], organizationId, `${name}@${domain}`, name],
    );
  }
  const creator = Object.values(users)[0]!;
  const courseId = uuidv7();
  await pool.query(
    "INSERT INTO courses (id, organization_id, name, created_by_user_id, status, join_code) VALUES ($1, $2, 'Course', $3, $4, $5)",
    [
      courseId,
      organizationId,
      creator,
      options.status ?? "active",
      randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
    ],
  );
  for (const [name, role] of Object.entries(members))
    await pool.query(
      "INSERT INTO course_memberships (course_id, user_id, role) VALUES ($1, $2, $3)",
      [courseId, users[name], role],
    );
  const postId = uuidv7();
  await pool.query(
    "INSERT INTO posts (id, course_id, author_user_id, type, title, body_markdown) VALUES ($1, $2, $3, 'question', 'Why does my loop never stop?', 'Body')",
    [postId, courseId, creator],
  );
  return { organizationId, courseId, postId, users };
}
