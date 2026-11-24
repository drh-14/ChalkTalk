import { expect, it } from "vitest";
import type { Pool } from "pg";
import { boundedQuery } from "./query.js";

it("a query timeout retains actual SQL ownership after rejecting authorization", async () => {
  let release!: () => void;
  const query = new Promise((done) => {
    release = () => done({ rows: [], rowCount: 0 });
  });
  const database = { query: () => query } as unknown as Pool;
  let settled = false;
  let retained: Promise<unknown> | undefined;
  const operation = boundedQuery(database, "SELECT 1", [], 10, (actual) => {
    retained = actual.then(() => {
      settled = true;
    });
  });
  await expect(operation).rejects.toThrow("Database query timed out");
  try {
    expect(retained).toBeDefined();
    expect(settled).toBe(false);
  } finally {
    release();
    await retained;
  }
  expect(settled).toBe(true);
});
