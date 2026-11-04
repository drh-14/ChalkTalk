import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const target = "056_resource_file_texts.sql";

suite("resource text migration", () => {
  it("queues exactly one pending extraction for each live catalog file", async () => {
    const admin = new Pool({ connectionString: url }),
      schema = `resource_text_${randomUUID().replaceAll("-", "")}`,
      directory = await mkdtemp(join(tmpdir(), "chalktalk-text-migrations-"));
    let pool: Pool | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: url,
        options: `--search_path="${schema}",public`,
      });
      const names = (await readdir(getMigrationDirectory())).filter((name) =>
        name.endsWith(".sql"),
      );
      for (const name of names)
        if (name !== target)
          await copyFile(
            join(getMigrationDirectory(), name),
            join(directory, name),
          );
      await runMigrations(pool, directory);

      const org = randomUUID(),
        user = randomUUID(),
        course = randomUUID();
      await pool.query(
        "INSERT INTO organizations(id,domain,name) VALUES($1,'text.example.edu','Example')",
        [org],
      );
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'ada@text.example.edu','Ada','x')",
        [user, org],
      );
      await pool.query(
        "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','TEXTMIGR')",
        [course, org, user],
      );
      const file = async (deleted = false) => {
        const id = randomUUID();
        await pool!.query(
          "INSERT INTO course_files(id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256,deleted_at) VALUES($1,$2,$3,$4,'notes.pdf','application/pdf',1,$5,$6)",
          [
            id,
            course,
            user,
            `files/${id}`,
            Buffer.alloc(32),
            deleted ? new Date() : null,
          ],
        );
        return id;
      };
      const resource = async (
        revisions: { fileId?: string; url?: string }[],
        removed = false,
      ) => {
        const id = randomUUID(),
          ids = revisions.map(() => randomUUID());
        await pool!.query("BEGIN");
        await pool!.query(
          "INSERT INTO course_resources(id,course_id,title,visibility,position,active_revision_id,deleted_at) VALUES($1,$2,'Resource','class',0,$3,$4)",
          [id, course, ids.at(-1), removed ? new Date() : null],
        );
        for (const [index, revision] of revisions.entries())
          await pool!.query(
            "INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,file_id,url) VALUES($1,$2,$3,$4,$5,$6)",
            [
              ids[index],
              id,
              course,
              revision.fileId ? "upload" : "link",
              revision.fileId ?? null,
              revision.url ?? null,
            ],
          );
        await pool!.query("COMMIT");
      };
      const live = await file(),
        replaced = await file(true),
        replacement = await file(),
        removed = await file(),
        syllabus = await file(),
        standalone = await file();
      await resource([{ fileId: live }]);
      await resource([{ fileId: replaced }, { fileId: replacement }]);
      await resource([{ fileId: removed }], true);
      await resource([{ url: "https://example.edu/handbook" }]);
      await pool.query(
        "INSERT INTO course_information(course_id,syllabus_file_id) VALUES($1,$2)",
        [course, syllabus],
      );

      await copyFile(
        join(getMigrationDirectory(), target),
        join(directory, target),
      );
      await runMigrations(pool, directory);

      const texts = await pool.query<{ file_id: string; status: string }>(
        "SELECT file_id,status FROM course_file_texts ORDER BY file_id",
      );
      expect(texts.rows).toEqual(
        [live, replacement]
          .sort()
          .map((file_id) => ({ file_id, status: "pending" })),
      );
      const jobs = await pool.query<{
        kind: string;
        payload: { fileId: string };
        deduplication_key: string;
        status: string;
        max_attempts: number;
      }>(
        "SELECT kind,payload,deduplication_key,status,max_attempts FROM jobs ORDER BY deduplication_key",
      );
      expect(jobs.rows).toEqual(
        [live, replacement].sort().map((fileId) => ({
          kind: "extract_file_text",
          payload: { fileId },
          deduplication_key: `file:${fileId}`,
          status: "queued",
          max_attempts: 3,
        })),
      );
      expect([removed, syllabus, standalone, replaced]).not.toContain(
        jobs.rows[0]!.payload.fileId,
      );

      await expect(
        pool.query(
          "INSERT INTO course_file_texts(file_id,course_id,status) VALUES($1,$2,'ready')",
          [standalone, course],
        ),
      ).rejects.toThrow();
      await pool.query(
        "UPDATE course_file_texts SET status='ready',text='Eigenvalues of symmetric matrices' WHERE file_id=$1",
        [live],
      );
      const match = await pool.query(
        "SELECT 1 FROM course_file_texts WHERE search_vector @@ websearch_to_tsquery('english','eigenvalue')",
      );
      expect(match.rowCount).toBe(1);
      await pool.query("DELETE FROM courses WHERE id=$1", [course]);
      expect(
        (await pool.query("SELECT 1 FROM course_file_texts")).rowCount,
      ).toBe(0);
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
