import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";
import {
  runTrackedSemanticMigration,
  verifySemanticCompatibility,
} from "./migrate-semantic.js";
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `semantic_local_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
integration("tracked bundled semantic migration", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(pool, getMigrationDirectory());
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });
  it("detects missing external prerequisites without changing catalogs", async () => {
    const before = (
      await pool.query(
        "SELECT relname FROM pg_class WHERE relnamespace=$1::regnamespace ORDER BY relname",
        [schema],
      )
    ).rows;
    await expect(verifySemanticCompatibility(pool)).rejects.toThrow("semantic");
    expect(
      (
        await pool.query(
          "SELECT relname FROM pg_class WHERE relnamespace=$1::regnamespace ORDER BY relname",
          [schema],
        )
      ).rows,
    ).toEqual(before);
  });
  it("tracks once and adopts compatible objects without replacing their identity", async () => {
    await runTrackedSemanticMigration(pool);
    const identity = (
      await pool.query("SELECT 'post_embeddings'::regclass::oid AS oid")
    ).rows;
    const initial = (
      await pool.query("SELECT * FROM semantic_schema_migrations")
    ).rows;
    expect(initial).toHaveLength(1);
    await runTrackedSemanticMigration(pool);
    await verifySemanticCompatibility(pool);
    expect(
      (await pool.query("SELECT * FROM semantic_schema_migrations")).rows,
    ).toEqual(initial);
    await pool.query("DROP TABLE semantic_schema_migrations");
    await runTrackedSemanticMigration(pool);
    expect(
      (await pool.query("SELECT 'post_embeddings'::regclass::oid AS oid")).rows,
    ).toEqual(identity);
    expect(
      (await pool.query("SELECT * FROM semantic_schema_migrations")).rows,
    ).toHaveLength(1);
  });
  it("rejects a missing creation-time default in external and bundled modes without repairing it", async () => {
    await pool.query(
      "ALTER TABLE post_embeddings ALTER COLUMN created_at DROP DEFAULT",
    );
    const identity = (
      await pool.query("SELECT 'post_embeddings'::regclass::oid AS oid")
    ).rows;
    const ledger = (
      await pool.query("SELECT * FROM semantic_schema_migrations")
    ).rows;
    await expect(verifySemanticCompatibility(pool)).rejects.toThrow("semantic");
    await expect(runTrackedSemanticMigration(pool)).rejects.toThrow("semantic");
    expect(
      (await pool.query("SELECT * FROM semantic_schema_migrations")).rows,
    ).toEqual(ledger);
    await pool.query("DROP TABLE semantic_schema_migrations");
    await expect(runTrackedSemanticMigration(pool)).rejects.toThrow("semantic");
    expect(
      (
        await pool.query(
          "SELECT to_regclass('semantic_schema_migrations') AS ledger",
        )
      ).rows[0].ledger,
    ).toBeNull();
    expect(
      (await pool.query("SELECT 'post_embeddings'::regclass::oid AS oid")).rows,
    ).toEqual(identity);
    expect(
      (
        await pool.query(
          "SELECT pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attrdef d WHERE d.adrelid='post_embeddings'::regclass AND d.adnum=(SELECT attnum FROM pg_attribute WHERE attrelid='post_embeddings'::regclass AND attname='created_at')",
        )
      ).rows,
    ).toEqual([]);
    await pool.query(
      "ALTER TABLE post_embeddings ALTER COLUMN created_at SET DEFAULT now()",
    );
    await verifySemanticCompatibility(pool);
    await runTrackedSemanticMigration(pool);
    expect(
      (await pool.query("SELECT * FROM semantic_schema_migrations")).rows,
    ).toHaveLength(1);
  });
  it("rejects a same-named but incompatible semantic index without repairing it", async () => {
    await pool.query("DROP INDEX post_embeddings_generation_post_idx");
    await pool.query(
      "CREATE INDEX post_embeddings_generation_post_idx ON post_embeddings(post_id)",
    );
    await expect(verifySemanticCompatibility(pool)).rejects.toThrow("semantic");
    await expect(runTrackedSemanticMigration(pool)).rejects.toThrow("semantic");
    await pool.query("DROP INDEX post_embeddings_generation_post_idx");
    await pool.query(
      "CREATE INDEX post_embeddings_generation_post_idx ON post_embeddings(generation,post_id,source_revision)",
    );
  });
  it("rejects a foreign key to another posts relation in external and bundled modes", async () => {
    const other = `${schema}_other`;
    await pool.query(`CREATE SCHEMA ${other}`);
    await pool.query(`CREATE TABLE ${other}.posts (id uuid PRIMARY KEY)`);
    await pool.query(
      "ALTER TABLE post_embeddings DROP CONSTRAINT post_embeddings_post_id_fkey",
    );
    await pool.query(
      `ALTER TABLE post_embeddings ADD CONSTRAINT post_embeddings_post_id_fkey FOREIGN KEY (post_id) REFERENCES ${other}.posts(id) ON DELETE CASCADE`,
    );
    try {
      await expect(verifySemanticCompatibility(pool)).rejects.toThrow(
        "semantic",
      );
      await expect(runTrackedSemanticMigration(pool)).rejects.toThrow(
        "semantic",
      );
      await pool.query("DROP TABLE semantic_schema_migrations");
      await expect(runTrackedSemanticMigration(pool)).rejects.toThrow(
        "semantic",
      );
      expect(
        (
          await pool.query(
            "SELECT to_regclass('semantic_schema_migrations') AS ledger",
          )
        ).rows[0].ledger,
      ).toBeNull();
    } finally {
      await pool.query(
        "ALTER TABLE post_embeddings DROP CONSTRAINT post_embeddings_post_id_fkey",
      );
      await pool.query(
        "ALTER TABLE post_embeddings ADD CONSTRAINT post_embeddings_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE",
      );
      await pool.query(`DROP SCHEMA ${other} CASCADE`);
    }
    await verifySemanticCompatibility(pool);
    await runTrackedSemanticMigration(pool);
  });
  it("refuses checksum or incompatible object drift without resetting data", async () => {
    await pool.query(
      "UPDATE semantic_schema_migrations SET checksum='mismatch'",
    );
    await expect(runTrackedSemanticMigration(pool)).rejects.toThrow("semantic");
    await pool.query("DROP TABLE semantic_schema_migrations");
    await pool.query(
      "ALTER TABLE post_embeddings DROP COLUMN source_revision CASCADE",
    );
    await expect(runTrackedSemanticMigration(pool)).rejects.toThrow("semantic");
    expect(
      (await pool.query("SELECT to_regclass('post_embeddings') AS retained"))
        .rows[0].retained,
    ).toBeTruthy();
    expect(
      (
        await pool.query(
          "SELECT to_regclass('semantic_schema_migrations') AS ledger",
        )
      ).rows[0].ledger,
    ).toBeNull();
  });
});
