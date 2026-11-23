import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "./pool.js";

async function semanticSql(): Promise<string> {
  return readFile(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../database/optional/semantic_search.sql",
    ),
    "utf8",
  );
}

async function verifyObjects(client: PoolClient): Promise<void> {
  const columns = await client.query<{
    name: string;
    type: string;
    required: boolean;
    default_expression: string | null;
  }>(`
    SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('post_embeddings') AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`);
  const expected = [
    ["post_id", "uuid"],
    ["generation", "text"],
    ["source_revision", "text"],
    ["chunk_ordinal", "integer"],
    ["embedding", "vector"],
    ["created_at", "timestamp with time zone"],
  ].map(([name, type]) => ({ name, type, required: true }));
  if (
    JSON.stringify(
      columns.rows.map(({ name, type, required }) => ({
        name,
        type,
        required,
      })),
    ) !== JSON.stringify(expected) ||
    columns.rows.find((row) => row.name === "created_at")
      ?.default_expression !== "now()"
  )
    throw new Error(
      "External semantic schema is missing or incompatible; provision semantic prerequisites explicitly",
    );
  const constraints = await client.query<{
    kind: string;
    definition: string;
    correct_reference: boolean;
  }>(
    `SELECT contype AS kind,pg_get_constraintdef(oid) AS definition,
      confrelid=to_regclass('posts') AS correct_reference
      FROM pg_constraint WHERE conrelid='post_embeddings'::regclass`,
  );
  const has = (kind: string, definition: string) =>
    constraints.rows.some(
      (row) => row.kind === kind && row.definition === definition,
    );
  if (
    !has("p", "PRIMARY KEY (post_id, generation, chunk_ordinal)") ||
    !has("c", "CHECK ((length(source_revision) = 64))") ||
    !has("c", "CHECK ((chunk_ordinal >= 0))") ||
    !constraints.rows.some(
      (row) =>
        row.kind === "f" &&
        row.correct_reference &&
        /^FOREIGN KEY \(post_id\) REFERENCES (?:[a-zA-Z0-9_]+\.)?posts\(id\) ON DELETE CASCADE$/.test(
          row.definition,
        ),
    )
  )
    throw new Error(
      "External semantic constraints are incompatible; inspect semantic prerequisites",
    );
  const indexes = [
    {
      name: "post_embeddings_generation_post_idx",
      table: "post_embeddings",
      columns: ["generation", "post_id", "source_revision"],
      predicate: "",
    },
    {
      name: "posts_semantic_backfill_updated_idx",
      table: "posts",
      columns: ["updated_at", "id"],
      predicate: "deleted_atISNULLANDduplicate_status<>'confirmed'::text",
    },
    {
      name: "jobs_semantic_dead_idx",
      table: "jobs",
      columns: ["updated_at", "id"],
      predicate: "kind::text='index_post'::textANDstatus='dead'::text",
    },
  ];
  for (const expected of indexes) {
    const result = await client.query<{
      valid: boolean;
      unique: boolean;
      correct_table: boolean;
      columns: string[];
      predicate: string | null;
      method: string;
    }>(
      `
      SELECT i.indisvalid AS valid,i.indisunique AS unique,i.indrelid=to_regclass($2) AS correct_table,
        ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum,position)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum ORDER BY key.position) AS columns,
        pg_get_expr(i.indpred,i.indrelid) AS predicate,am.amname AS method
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
      WHERE i.indexrelid=to_regclass($1)`,
      [expected.name, expected.table],
    );
    const index = result.rows[0];
    if (
      !index?.valid ||
      index.unique ||
      !index.correct_table ||
      index.method !== "btree" ||
      JSON.stringify(index.columns) !== JSON.stringify(expected.columns) ||
      (index.predicate ?? "").replace(/[()\s]/g, "") !== expected.predicate
    )
      throw new Error(
        "External semantic indexes are missing or incompatible; provision semantic prerequisites explicitly",
      );
  }
}

/** No DDL: safe to use against an externally owned database. */
export async function verifySemanticCompatibility(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await verifyObjects(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runTrackedSemanticMigration(pool: Pool): Promise<void> {
  const sql = await semanticSql();
  const checksum = createHash("sha256").update(sql).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724023007)");
    const ledger = await client.query(
      "SELECT to_regclass('semantic_schema_migrations') AS ledger",
    );
    if (ledger.rows[0].ledger) {
      const row = await client.query(
        "SELECT version,checksum FROM semantic_schema_migrations",
      );
      if (
        row.rows.length !== 1 ||
        row.rows[0].version !== 1 ||
        row.rows[0].checksum !== checksum
      )
        throw new Error(
          "Bundled semantic migration version/checksum mismatch; inspect before upgrading",
        );
      await verifyObjects(client);
    } else {
      const existing = await client.query(
        "SELECT to_regclass('post_embeddings') AS existing",
      );
      if (existing.rows[0].existing) await verifyObjects(client);
      else {
        await client.query(sql);
        await verifyObjects(client);
      }
      await client.query(
        "CREATE TABLE semantic_schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await client.query(
        "INSERT INTO semantic_schema_migrations (version,checksum) VALUES (1,$1)",
        [checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runSemanticMigration(pool: Pool): Promise<void> {
  await pool.query(await semanticSql());
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const pool = createPool(requireDatabaseUrl(loadEnvironment()));
  try {
    await runSemanticMigration(pool);
  } finally {
    await pool.end();
  }
}
