import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import * as Y from "yjs";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `save_only_answers_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  user: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
  post: "01a0e5cc-58ae-7009-9f43-e69b17afee03",
  answer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  markerPost: "01a0e5cc-58ae-7009-9f43-e69b17afee04",
  markerAnswer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e09",
  emptyPost: "01a0e5cc-58ae-7009-9f43-e69b17afee05",
  emptyAnswer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e0a",
};
let admin: Pool;
let pool: Pool;
let priorDirectory: string;
const state = (text: string) => {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};

integration("save-only answer cutover", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    priorDirectory = await mkdtemp(join(tmpdir(), "chalktalk-save-only-"));
    for (const name of (await readdir(getMigrationDirectory())).filter(
      (name) => name.endsWith(".sql") && name < "014_",
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
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'user@example.edu','User','x')",
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
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Question','Body')",
      [ids.post, ids.course, ids.user],
    );
    await pool.query(
      "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor,version) VALUES ($1,$2,$3,'student','Saved **answer**',$4,'student',7)",
      [ids.answer, ids.course, ids.post, ids.user],
    );
    await pool.query(
      "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
      [ids.answer, ids.user],
    );
    await pool.query(
      "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
      [ids.answer, state("Divergent")],
    );
    for (const [postId, answerId, body] of [
      [ids.markerPost, ids.markerAnswer, "Initial answer"],
      [ids.emptyPost, ids.emptyAnswer, ""],
    ]) {
      await pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Question','Body')",
        [postId, ids.course, ids.user],
      );
      await pool.query(
        "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES ($1,$2,$3,'student',$4,$5,'student')",
        [answerId, ids.course, postId, body || "Temporary", ids.user],
      );
      await pool.query(
        "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
        [answerId, Buffer.from([0, 0])],
      );
    }
    // Simulate a historical temporary empty live answer without changing its version.
    const constraint = await pool.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid='answers'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%body_markdown%' LIMIT 1",
    );
    await pool.query(
      `ALTER TABLE answers DROP CONSTRAINT "${constraint.rows[0].conname}"`,
    );
    await pool.query(
      "ALTER TABLE answers ADD CONSTRAINT answers_body_live_check CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) <= 100000) OR (deleted_at IS NOT NULL AND body_markdown IS NULL))",
    );
    await pool.query("UPDATE answers SET body_markdown='' WHERE id=$1", [
      ids.emptyAnswer,
    ]);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await rm(priorDirectory, { recursive: true, force: true });
  });

  it("aborts on divergent and corrupt Yjs without dropping data, then preserves matching Markdown and attribution", async () => {
    await expect(runMigrations(pool, getMigrationDirectory())).rejects.toThrow(
      /answer.*mismatch/i,
    );
    expect(
      (
        await pool.query(
          "SELECT yjs_state FROM answer_collaboration_documents WHERE answer_id=$1",
          [ids.answer],
        )
      ).rowCount,
    ).toBe(1);
    await pool.query(
      "UPDATE answer_collaboration_documents SET yjs_state=$2 WHERE answer_id=$1",
      [ids.answer, Buffer.from([255, 255])],
    );
    await expect(runMigrations(pool, getMigrationDirectory())).rejects.toThrow(
      /answer.*invalid/i,
    );
    await pool.query(
      "UPDATE answer_collaboration_documents SET yjs_state=$2 WHERE answer_id=$1",
      [ids.answer, state("Saved **answer**")],
    );
    // A mismatch after more than one preflight page must abort the whole cutover.
    for (let index = 0; index < 101; index++) {
      const postId = uuidv7();
      const answerId = uuidv7();
      await pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Question','Body')",
        [postId, ids.course, ids.user],
      );
      await pool.query(
        "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES ($1,$2,$3,'student','Batch answer',$4,'student')",
        [answerId, ids.course, postId, ids.user],
      );
      await pool.query(
        "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
        [answerId, state("Batch answer")],
      );
    }
    await pool.query(
      "UPDATE answer_collaboration_documents SET yjs_state=$2 WHERE answer_id=$1",
      [ids.answer, state("Late mismatch")],
    );
    await expect(runMigrations(pool, getMigrationDirectory())).rejects.toThrow(
      /answer.*mismatch/i,
    );
    await pool.query(
      "UPDATE answer_collaboration_documents SET yjs_state=$2 WHERE answer_id=$1",
      [ids.answer, state("Saved **answer**")],
    );
    await runMigrations(pool, getMigrationDirectory());
    expect(
      (
        await pool.query(
          "SELECT to_regclass('answer_collaboration_documents') AS name",
        )
      ).rows[0].name,
    ).toBeNull();
    expect(
      (await pool.query("SELECT to_regclass('collaboration_tickets') AS name"))
        .rows[0].name,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT body_markdown,version FROM answers WHERE id=$1",
          [ids.answer],
        )
      ).rows[0],
    ).toEqual({ body_markdown: "Saved **answer**", version: "7" });
    expect(
      (
        await pool.query(
          "SELECT user_id FROM answer_contributors WHERE answer_id=$1",
          [ids.answer],
        )
      ).rows,
    ).toEqual([{ user_id: ids.user }]);
    expect(
      (
        await pool.query("SELECT body_markdown FROM answers WHERE id=$1", [
          ids.markerAnswer,
        ])
      ).rows[0].body_markdown,
    ).toBe("Initial answer");
    expect(
      (
        await pool.query("SELECT body_markdown FROM answers WHERE id=$1", [
          ids.emptyAnswer,
        ])
      ).rows[0].body_markdown,
    ).toBe("");
  });
});
