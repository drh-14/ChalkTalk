import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "./pool.js";

export async function runSemanticMigration(pool: Pool): Promise<void> {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../database/optional/semantic_search.sql",
  );
  const sql = await readFile(path, "utf8");
  await pool.query(sql);
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
