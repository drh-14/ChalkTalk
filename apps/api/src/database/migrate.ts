import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "./pool.js";

interface Migration {
  name: string;
  sql: string;
}

async function readMigrations(directory: string): Promise<Migration[]> {
  const files = await readdir(directory, { withFileTypes: true });
  const migrationNames = files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(resolve(directory, name), "utf8"),
    })),
  );
}

export async function runMigrations(
  pool: Pool,
  directory: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = await readMigrations(directory);
    const completed = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const completedNames = new Set(completed.rows.map((row) => row.name));

    for (const migration of migrations) {
      if (completedNames.has(migration.name)) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

async function main() {
  const environment = loadEnvironment();
  const pool = createPool(requireDatabaseUrl(environment));

  try {
    await runMigrations(pool, resolve(process.cwd(), "database/migrations"));
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await main();
}
