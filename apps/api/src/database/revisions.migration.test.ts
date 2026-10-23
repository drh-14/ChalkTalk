import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `revisions_migration_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
let priorDirectory: string;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  user: uuidv7(),
  target: uuidv7(),
  merged: uuidv7(),
  deleted: uuidv7(),
  answer: uuidv7(),
  followup: uuidv7(),
};

integration("revision baseline migration", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    priorDirectory = await mkdtemp(
      join(tmpdir(), "chalktalk-before-revisions-"),
    );
    for (const name of await readdir(getMigrationDirectory()))
      if (name.endsWith(".sql") && name < "047_content_text_revisions.sql")
        await writeFile(
          join(priorDirectory, name),
          await readFile(join(getMigrationDirectory(), name)),
        );
    await runMigrations(pool, priorDirectory);
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    await pool.query(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'author@example.edu','Author','x')",
      [ids.user, ids.org],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.org, ids.user],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.course, ids.user],
    );
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,anonymous) VALUES ($1,$2,$3,'question','Target','Current body',true)",
      [ids.target, ids.course, ids.user],
    );
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,duplicate_of_post_id,duplicate_status) VALUES ($1,$2,$3,'question','Merged','Retained text',$4,'confirmed')",
      [ids.merged, ids.course, ids.user, ids.target],
    );
    await pool.query(
      "INSERT INTO posts(id,course_id,type,deleted_at) VALUES ($1,$2,'question',now())",
      [ids.deleted, ids.course],
    );
    await pool.query(
      "INSERT INTO answers(id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor,anonymous) VALUES ($1,$2,$3,'staff','Answer text',$4,'instructor',true)",
      [ids.answer, ids.course, ids.target, ids.user],
    );
    await pool.query(
      "INSERT INTO followups(id,course_id,post_id,author_user_id,body_markdown,anonymous) VALUES ($1,$2,$3,$4,'Followup text',true)",
      [ids.followup, ids.course, ids.target, ids.user],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    if (priorDirectory)
      await rm(priorDirectory, { recursive: true, force: true });
  });

  it("captures current live and merged text once, without a guessed editor or historical timestamp", async () => {
    await runMigrations(pool, getMigrationDirectory());
    const rows = await pool.query<{
      kind: string;
      resource_id: string;
      title: string | null;
      body_markdown: string;
      editor_user_id: string | null;
      baseline: boolean;
      anonymous: boolean;
      resource_version: string;
    }>(
      "SELECT kind,resource_id,title,body_markdown,editor_user_id,baseline,anonymous,resource_version FROM content_text_revisions ORDER BY kind,resource_id",
    );
    expect(rows.rows).toHaveLength(4);
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "post",
          resource_id: ids.target,
          title: "Target",
          body_markdown: "Current body",
          editor_user_id: null,
          baseline: true,
          anonymous: true,
          resource_version: "1",
        }),
        expect.objectContaining({
          kind: "post",
          resource_id: ids.merged,
          title: "Merged",
          body_markdown: "Retained text",
          editor_user_id: null,
          baseline: true,
          anonymous: false,
        }),
        expect.objectContaining({
          kind: "answer",
          resource_id: ids.answer,
          body_markdown: "Answer text",
          editor_user_id: null,
          anonymous: true,
        }),
        expect.objectContaining({
          kind: "followup",
          resource_id: ids.followup,
          body_markdown: "Followup text",
          editor_user_id: null,
          anonymous: true,
        }),
      ]),
    );
    expect(rows.rows.some((row) => row.resource_id === ids.deleted)).toBe(
      false,
    );
    await runMigrations(pool, getMigrationDirectory());
    expect(
      (await pool.query("SELECT 1 FROM content_text_revisions")).rowCount,
    ).toBe(4);
  });
});
