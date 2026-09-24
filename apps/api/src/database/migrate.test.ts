import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? describe : describe.skip;
const migrationName = `migration_test_${Date.now()}`;
const markerTable = `migration_marker_${Date.now()}`;
let pool: Pool;
let migrationDirectory: string;

describe("getMigrationDirectory", () => {
  it("resolves the repository migration directory independently of the process directory", () => {
    return expect(
      access(join(getMigrationDirectory(), "001_create_migration_ledger.sql")),
    ).resolves.toBeUndefined();
  });
});

integrationTest("runMigrations", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: testDatabaseUrl });
    migrationDirectory = await mkdtemp(join(tmpdir(), "chalktalk-migrations-"));

    await writeFile(
      join(migrationDirectory, `001_${migrationName}_first.sql`),
      `CREATE TABLE ${markerTable} (position integer PRIMARY KEY);\nINSERT INTO ${markerTable} (position) VALUES (1);\n`,
    );
    await writeFile(
      join(migrationDirectory, `002_${migrationName}_second.sql`),
      `INSERT INTO ${markerTable} (position) VALUES (2);\n`,
    );
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${markerTable}`);
    await pool.query("DELETE FROM schema_migrations WHERE name LIKE $1", [
      `%${migrationName}%`,
    ]);
    await pool.end();
    await rm(migrationDirectory, { force: true, recursive: true });
  });

  it("applies ordered migrations exactly once", async () => {
    await runMigrations(pool, migrationDirectory);
    await runMigrations(pool, migrationDirectory);

    const markerRows = await pool.query<{ position: number }>(
      `SELECT position FROM ${markerTable} ORDER BY position`,
    );
    const recordedMigrations = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name LIKE $1 ORDER BY name",
      [`%${migrationName}%`],
    );

    expect(markerRows.rows).toEqual([{ position: 1 }, { position: 2 }]);
    expect(recordedMigrations.rows).toHaveLength(2);
  });
});
