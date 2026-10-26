import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `advanced_polls_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
let priorDirectory: string;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75832001",
  user: "01a0e5cc-58ae-7009-9f43-d1ba75832002",
  course: "01a0e5cc-58ae-7009-9f43-d1ba75832003",
  post: "01a0e5cc-58ae-7009-9f43-d1ba75832004",
  option: "01a0e5cc-58ae-7009-9f43-d1ba75832005",
};

integration("advanced polls migration", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    priorDirectory = await mkdtemp(join(tmpdir(), "chalktalk-prior-polls-"));
    for (const name of (await readdir(getMigrationDirectory())).filter(
      (name) => name.endsWith(".sql") && name < "048_",
    ))
      await writeFile(
        join(priorDirectory, name),
        await readFile(join(getMigrationDirectory(), name)),
      );
    await runMigrations(pool, priorDirectory);
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'poll@example.edu','Poll','x')",
      [ids.user, ids.organization],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Course','ABCDEFGH')",
      [ids.course, ids.organization, ids.user],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.course, ids.user],
    );
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'poll','Legacy','Body')",
      [ids.post, ids.course, ids.user],
    );
    await pool.query(
      "INSERT INTO poll_options (id,course_id,post_id,position,label) VALUES ($1,$2,$3,0,'A')",
      [ids.option, ids.course, ids.post],
    );
    await pool.query(
      "INSERT INTO poll_votes (course_id,post_id,user_id,option_id) VALUES ($1,$2,$3,$4)",
      [ids.course, ids.post, ids.user, ids.option],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await rm(priorDirectory, { recursive: true, force: true });
  });
  it("backfills legacy settings and retains each ballot while widening the key", async () => {
    await runMigrations(pool, getMigrationDirectory());
    const settings = await pool.query(
      "SELECT selection_mode,max_selections,release_mode,results_released_at IS NOT NULL AS released FROM poll_settings WHERE post_id=$1",
      [ids.post],
    );
    expect(settings.rows[0]).toEqual({
      selection_mode: "single",
      max_selections: 1,
      release_mode: "live",
      released: true,
    });
    const existing = await pool.query(
      "SELECT option_id FROM poll_votes WHERE post_id=$1 AND user_id=$2",
      [ids.post, ids.user],
    );
    expect(existing.rows).toEqual([{ option_id: ids.option }]);
    const other = await pool.query<{ id: string }>(
      "INSERT INTO poll_options (id,course_id,post_id,position,label) VALUES (gen_random_uuid(),$1,$2,1,'B') RETURNING id",
      [ids.course, ids.post],
    );
    await pool.query(
      "INSERT INTO poll_votes (course_id,post_id,user_id,option_id) VALUES ($1,$2,$3,$4)",
      [ids.course, ids.post, ids.user, other.rows[0]!.id],
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM poll_votes WHERE post_id=$1 AND user_id=$2",
          [ids.post, ids.user],
        )
      ).rows[0].count,
    ).toBe(2);
  });
});
