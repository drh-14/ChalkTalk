import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient, QueryResult } from "pg";
import * as Y from "yjs";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "./pool.js";

interface Migration {
  name: string;
  sql: string;
}

const ANSWER_DOCUMENT_BATCH_SIZE = 8;
type AnswerProjectionRow = {
  id: string;
  body_markdown: string;
  yjs_state: Buffer;
};

async function verifyAnswerProjection(client: PoolClient) {
  // The lock keeps the preflight and DROP atomic with respect to old writers.
  await client.query(
    "LOCK TABLE answer_collaboration_documents IN ACCESS EXCLUSIVE MODE",
  );
  let cursor: string | null = null;
  while (true) {
    const documents: QueryResult<AnswerProjectionRow> = await client.query(
      `SELECT a.id,a.body_markdown,d.yjs_state
       FROM answers a JOIN answer_collaboration_documents d ON d.answer_id=a.id
       WHERE a.deleted_at IS NULL AND ($1::uuid IS NULL OR a.id > $1::uuid)
       ORDER BY a.id LIMIT $2`,
      [cursor, ANSWER_DOCUMENT_BATCH_SIZE],
    );
    for (const row of documents.rows) {
      // The original unseeded marker can coexist with initial Markdown text.
      if (row.yjs_state.equals(Buffer.from([0, 0]))) continue;
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, row.yjs_state);
        if (doc.share.size !== 1 || !doc.share.has("content"))
          throw new Error("unsupported document structure");
        const text = doc.getText("content");
        if (
          text
            .toDelta()
            .some(
              (part: { insert: unknown }) => typeof part.insert !== "string",
            )
        )
          throw new Error("unsupported document structure");
        if (text.toString() !== row.body_markdown)
          throw new Error(`answer ${row.id} projection mismatch`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("projection mismatch")
        )
          throw error;
        throw new Error(`answer ${row.id} Yjs state invalid`, {
          cause: error,
        });
      } finally {
        doc.destroy();
      }
    }
    if (documents.rows.length < ANSWER_DOCUMENT_BATCH_SIZE) break;
    cursor = documents.rows.at(-1)!.id;
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
        if (migration.name === "014_save_only_answers.sql")
          await verifyAnswerProjection(client);
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
