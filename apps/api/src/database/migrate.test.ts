import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("migration CLI", () => {
  it("runs when invoked with a relative path", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        "process.argv[1] = 'apps/api/src/database/migrate.ts'; await import('./apps/api/src/database/migrate.ts')",
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: {
          NODE_ENV: "test",
          AUTH_TOKEN_SECRET: "invalid",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "AUTH_TOKEN_SECRET must contain at least 32 characters",
    );
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
    if (
      (await pool.query("SELECT to_regclass('schema_migrations') AS ledger"))
        .rows[0]?.ledger
    ) {
      await pool.query("DELETE FROM schema_migrations WHERE name LIKE $1", [
        `%${migrationName}%`,
      ]);
    }
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

  it("serializes concurrent migration startup on a fresh schema", async () => {
    const schema = `migration_concurrent_${process.pid}_${Date.now()}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const first = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schema}`,
    });
    const second = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schema}`,
    });
    try {
      await Promise.all([
        runMigrations(first, migrationDirectory),
        runMigrations(second, migrationDirectory),
      ]);
      const result = await first.query<{ count: string }>(
        "SELECT count(*) FROM schema_migrations",
      );
      expect(result.rows[0].count).toBe("2");
    } finally {
      await Promise.all([first.end(), second.end()]);
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });
});
