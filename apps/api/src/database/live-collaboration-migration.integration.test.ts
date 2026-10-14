import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `live_collaboration_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  user: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
  post: "01a0e5cc-58ae-7009-9f43-e69b17afee03",
  answer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  followup: "01a0e5cc-58ae-7009-9f43-e237164911eb",
};
let admin: Pool;
let pool: Pool;
let priorDirectory: string;

integration("live collaboration migration", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    priorDirectory = await mkdtemp(join(tmpdir(), "chalktalk-migrations-"));
    for (const name of (await readdir(getMigrationDirectory())).filter(
      (name) => name.endsWith(".sql") && name < "011_",
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
      "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES ($1,$2,$3,'student','Answer',$4,'student')",
      [ids.answer, ids.course, ids.post, ids.user],
    );
    await pool.query(
      "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
      [ids.answer, Buffer.from([0, 0])],
    );
    await pool.query(
      "INSERT INTO followups (id,course_id,post_id,author_user_id,body_markdown) VALUES ($1,$2,$3,$4,'Original followup')",
      [ids.followup, ids.course, ids.post, ids.user],
    );
    await runMigrations(pool, getMigrationDirectory());
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await rm(priorDirectory, { recursive: true, force: true });
  });

  it("preserves the existing followup and provides a Yjs document", async () => {
    const saved = await pool.query<{
      body_markdown: string;
      yjs_state: Buffer;
      persistence_revision: string;
    }>(
      "SELECT f.body_markdown,d.yjs_state,d.persistence_revision FROM followups f JOIN followup_collaboration_documents d ON d.followup_id=f.id WHERE f.id=$1",
      [ids.followup],
    );
    expect(saved.rows[0]?.body_markdown).toBe("Original followup");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved.rows[0]!.yjs_state);
    expect(doc.getText("content").toString()).toBe("Original followup");
    expect(saved.rows[0]?.persistence_revision).toBe("0");
  });

  it("allows a temporary empty live body while keeping deleted bodies null", async () => {
    await pool.query("UPDATE answers SET body_markdown='' WHERE id=$1", [
      ids.answer,
    ]);
    await pool.query("UPDATE followups SET body_markdown='' WHERE id=$1", [
      ids.followup,
    ]);
    expect(
      (
        await pool.query("SELECT body_markdown FROM answers WHERE id=$1", [
          ids.answer,
        ])
      ).rows[0].body_markdown,
    ).toBe("");
    expect(
      (
        await pool.query("SELECT body_markdown FROM followups WHERE id=$1", [
          ids.followup,
        ])
      ).rows[0].body_markdown,
    ).toBe("");
    await expect(
      pool.query("UPDATE followups SET body_markdown=NULL WHERE id=$1", [
        ids.followup,
      ]),
    ).rejects.toThrow();
  });
});
