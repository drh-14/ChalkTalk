import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `shared_answers_migration_${process.pid}_${Date.now()}`;
const id = {
  org: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
  post: "01a0e5cc-58ae-7009-9f43-e69b17afee03",
  student: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  staff: "01a0e5cc-58ae-7009-9f43-cd86eb2ae706",
  extra: "01a0e5cc-58ae-7009-9f43-ddd412c38e07",
  studentAnswer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  staffAnswer: "01a0e5cc-58ae-7009-9f43-e237164911e9",
  taPost: "01a0e5cc-58ae-7009-9f43-e237164911eb",
  taAnswer: "01a0e5cc-58ae-7009-9f43-e237164911ec",
};
let admin: Pool;
let pool: Pool;
let priorDirectory: string;
integration("shared-answer migration", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    priorDirectory = await mkdtemp(join(tmpdir(), "chalktalk-migrations-"));
    for (const name of (await readdir(getMigrationDirectory())).filter(
      (name) => name.endsWith(".sql") && name < "010_",
    ))
      await writeFile(
        join(priorDirectory, name),
        await readFile(join(getMigrationDirectory(), name)),
      );
    await runMigrations(pool, priorDirectory);
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [id.org],
    );
    for (const [user, name] of [
      [id.student, "Student"],
      [id.staff, "Staff"],
      [id.extra, "Extra"],
    ])
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$3,'x')",
        [user, id.org, `${name.toLowerCase()}@example.edu`],
      );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Course','ABCDEFGH')",
      [id.course, id.org, id.student],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'ta'),($1,$4,'ta')",
      [id.course, id.student, id.staff, id.extra],
    );
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Question','Body')",
      [id.post, id.course, id.student],
    );
    for (const [answerId, kind, body, author] of [
      [id.studentAnswer, "student", "Student text", id.student],
      [id.staffAnswer, "staff", "Staff text", id.staff],
    ]) {
      await pool.query(
        "INSERT INTO answers (id,course_id,post_id,kind,body_markdown) VALUES ($1,$2,$3,$4,$5)",
        [answerId, id.course, id.post, kind, body],
      );
      await pool.query(
        "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
        [answerId, author],
      );
      await pool.query(
        "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
        [answerId, Buffer.from([0, 0])],
      );
    }
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Another','Body')",
      [id.taPost, id.course, id.student],
    );
    await pool.query(
      "INSERT INTO answers (id,course_id,post_id,kind,body_markdown) VALUES ($1,$2,$3,'staff','TA text')",
      [id.taAnswer, id.course, id.taPost],
    );
    await pool.query(
      "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
      [id.taAnswer, id.extra],
    );
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [id.course, id.staff],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    if (priorDirectory)
      await rm(priorDirectory, { recursive: true, force: true });
  });

  it("rejects ambiguous contributor history, then preserves cards and backfills conservative floors", async () => {
    await pool.query(
      "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
      [id.studentAnswer, id.extra],
    );
    await expect(runMigrations(pool, getMigrationDirectory())).rejects.toThrow(
      /Cannot infer legacy answer creator/,
    );
    await pool.query(
      "DELETE FROM answer_contributors WHERE answer_id=$1 AND user_id=$2",
      [id.studentAnswer, id.extra],
    );
    await runMigrations(pool, getMigrationDirectory());
    const result = await pool.query(
      "SELECT id,body_markdown,created_by_user_id,edit_role_floor FROM answers WHERE post_id=$1 ORDER BY id",
      [id.post],
    );
    expect(result.rows).toEqual([
      {
        id: id.staffAnswer,
        body_markdown: "Staff text",
        created_by_user_id: id.staff,
        edit_role_floor: "instructor",
      },
      {
        id: id.studentAnswer,
        body_markdown: "Student text",
        created_by_user_id: id.student,
        edit_role_floor: "student",
      },
    ]);
    const ta = await pool.query(
      "SELECT created_by_user_id,edit_role_floor FROM answers WHERE id=$1",
      [id.taAnswer],
    );
    expect(ta.rows[0]).toEqual({
      created_by_user_id: id.extra,
      edit_role_floor: "ta",
    });
    await expect(
      pool.query(
        "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES ($1,$2,$3,'student','Third card',$4,'student')",
        [id.extra, id.course, id.post, id.student],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM answers WHERE post_id=$1",
          [id.post],
        )
      ).rows[0].count,
    ).toBe(2);
  });
});
