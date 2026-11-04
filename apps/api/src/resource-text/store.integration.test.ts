import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { MAX_TEXT_LENGTH, normalizeText } from "./normalize.js";
import {
  storeExtractedText,
  storeExtractionFailure,
  type ExtractedText,
} from "./store.js";

const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip,
  schema = `resource_text_store_${process.pid}_${Date.now()}`,
  course = randomUUID();
let pool: Pool, admin: Pool;

async function writeText(fileId: string, result: ExtractedText) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stored = await storeExtractedText(client, fileId, result);
    await client.query("COMMIT");
    return stored;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const pendingFile = async () => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO course_files(id,course_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES($1,$2,$3,'f.txt','text/plain',1,$4)",
    [id, course, `files/${id}`, Buffer.alloc(32)],
  );
  await pool.query(
    "INSERT INTO course_file_texts(file_id,course_id) VALUES($1,$2)",
    [id, course],
  );
  return id;
};
const row = async (id: string) =>
  (
    await pool.query<{
      status: string;
      text: string | null;
      truncated: boolean;
      failure_code: string | null;
    }>(
      "SELECT status,text,truncated,failure_code FROM course_file_texts WHERE file_id=$1",
      [id],
    )
  ).rows[0];

suite("extracted text storage", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}",public`,
    });
    await runMigrations(pool, getMigrationDirectory());
    const org = randomUUID(),
      user = randomUUID();
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'store.example.edu','Example')",
      [org],
    );
    await pool.query(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'s@store.example.edu','S','x')",
      [user, org],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','STORETXT')",
      [course, org, user],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("stores worst-case dense text by shortening it below the tsvector limit", async () => {
    const id = await pendingFile();
    // Unique two-character CJK words are 3 UTF-8 bytes per character and
    // never repeat, so 500,000 characters of them exceed 1 MB of lexemes.
    const tokens: string[] = [];
    for (let index = 0; tokens.length * 3 < MAX_TEXT_LENGTH * 2; index += 1)
      tokens.push(
        String.fromCodePoint(0x4e00 + (index % 20000)) +
          String.fromCodePoint(0x4e00 + Math.floor(index / 20000)),
      );
    const dense = normalizeText(tokens.join(" "));
    expect(dense.truncated).toBe(true);
    await expect(
      pool.query("SELECT to_tsvector('english',$1)", [dense.text]),
    ).rejects.toMatchObject({ code: "54000" });

    expect(await writeText(id, dense)).toBe(true);
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "ready", truncated: true });
    expect(stored!.text!.length).toBeLessThan(dense.text.length);
    expect(dense.text.startsWith(stored!.text!)).toBe(true);
  });

  it.each(["retained slide and notes", ""])(
    "preserves truncation for partial extraction text %j below the storage cap",
    async (text) => {
      const id = await pendingFile();
      expect(await writeText(id, { text, truncated: true })).toBe(true);
      expect(await row(id)).toMatchObject({
        status: "ready",
        text,
        truncated: true,
        failure_code: null,
      });
    },
  );

  it("writes only pending rows and never overwrites a final result", async () => {
    const id = await pendingFile();
    expect(await writeText(id, { text: "first", truncated: false })).toBe(true);
    expect(await writeText(id, { text: "second", truncated: false })).toBe(
      false,
    );
    expect(await storeExtractionFailure(pool, id, "failed", "late")).toBe(
      false,
    );
    expect(await row(id)).toMatchObject({ status: "ready", text: "first" });

    const failed = await pendingFile();
    expect(
      await storeExtractionFailure(pool, failed, "failed", "encrypted_pdf"),
    ).toBe(true);
    expect(await row(failed)).toMatchObject({
      status: "failed",
      text: null,
      failure_code: "encrypted_pdf",
    });
    expect(
      await writeText(randomUUID(), {
        text: "gone",
        truncated: false,
      }),
    ).toBe(false);
  });
});
