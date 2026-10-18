import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import * as Y from "yjs";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "./pool.js";

interface Migration {
  name: string;
  sql: string;
}

async function backfillFollowupDocuments(client: PoolClient): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const result: { rows: Array<{ id: string; body_markdown: string }> } =
      await client.query(
        `SELECT id,body_markdown FROM followups
         WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR id > $1::uuid)
         ORDER BY id LIMIT 250`,
        [cursor],
      );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      const doc = new Y.Doc();
      try {
        doc.getText("content").insert(0, row.body_markdown);
        await client.query(
          "INSERT INTO followup_collaboration_documents (followup_id,yjs_state) VALUES ($1,$2)",
          [row.id, Buffer.from(Y.encodeStateAsUpdate(doc))],
        );
      } finally {
        doc.destroy();
      }
    }
    cursor = result.rows.at(-1)!.id;
  }
}

export function getMigrationDirectory(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../database/migrations",
  );
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
        if (migration.name === "011_live_content_editing.sql")
          await backfillFollowupDocuments(client);
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
    await runMigrations(pool, getMigrationDirectory());
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
