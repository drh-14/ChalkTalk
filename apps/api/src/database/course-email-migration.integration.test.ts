import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration("per-course email migration", () => {
  const schema = `course_email_migration_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let pool: Pool;
  let staging: string;
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    if (staging) await rm(staging, { recursive: true, force: true });
  });

  it("backfills every existing membership from the legacy user choice, then defaults new joins", async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    staging = await mkdtemp(join(tmpdir(), "chalktalk-course-email-"));
    const original = getMigrationDirectory();
    for (const file of await readdir(original)) {
      if (
        !file.endsWith(".sql") ||
        file === "040_course_notification_preferences.sql"
      )
        continue;
      await writeFile(
        join(staging, file),
        await readFile(join(original, file)),
      );
    }
    await runMigrations(pool, staging);
    const org = "01a16092-1111-7000-8000-000000000001";
    const optedIn = "01a16092-1111-7000-8000-000000000002";
    const optedOut = "01a16092-1111-7000-8000-000000000003";
    const courseA = "01a16092-1111-7000-8000-000000000004";
    const courseB = "01a16092-1111-7000-8000-000000000005";
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [org],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash,notification_emails) VALUES ($1,$3,'one@example.edu','One','x',true),($2,$3,'two@example.edu','Two','x',false)",
      [optedIn, optedOut, org],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$3,$4,'Course A','ABCDEFGH'),($2,$3,$4,'Course B','BCDEFGHI')",
      [courseA, courseB, org, optedIn],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$3,'instructor'),($2,$3,'instructor'),($1,$4,'student')",
      [courseA, courseB, optedIn, optedOut],
    );
    await runMigrations(pool, original);
    const prior = await pool.query(
      "SELECT course_id,user_id,activity_emails,announcement_emails,digest_emails FROM course_memberships ORDER BY course_id,user_id",
    );
    expect(
      prior.rows.map(
        ({ user_id, activity_emails, announcement_emails, digest_emails }) => ({
          user_id,
          activity_emails,
          announcement_emails,
          digest_emails,
        }),
      ),
    ).toEqual([
      {
        user_id: optedIn,
        activity_emails: true,
        announcement_emails: true,
        digest_emails: true,
      },
      {
        user_id: optedOut,
        activity_emails: false,
        announcement_emails: true,
        digest_emails: true,
      },
      {
        user_id: optedIn,
        activity_emails: true,
        announcement_emails: true,
        digest_emails: true,
      },
    ]);
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [courseB, optedOut],
    );
    const fresh = await pool.query(
      "SELECT activity_emails,announcement_emails,digest_emails FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [courseB, optedOut],
    );
    expect(fresh.rows[0]).toEqual({
      activity_emails: false,
      announcement_emails: true,
      digest_emails: true,
    });
  });
});
