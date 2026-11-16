import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertIsolatedDatabase } from "./live-stack.mjs";

describe("live browser seed isolation", () => {
  const options = {
    databaseUrl: "postgresql://localhost/chalktalk",
    expectedToken: "a".repeat(48),
    expectedSystemIdentifier: "1234567890123456789",
  };
  const database = (
    systemIdentifier = options.expectedSystemIdentifier,
    token = options.expectedToken,
  ) => ({
    query: async (sql) =>
      sql.includes("pg_control_system")
        ? { rows: [{ system_identifier: systemIdentifier }] }
        : { rows: [{ token }] },
  });

  it("rejects missing isolation inputs before querying", async () => {
    let queried = false;
    const target = { query: async () => ((queried = true), { rows: [] }) };
    for (const key of Object.keys(options))
      await assert.rejects(
        () => assertIsolatedDatabase(target, { ...options, [key]: undefined }),
        /required/i,
      );
    assert.equal(queried, false);
  });

  it("rejects a database instance that differs from Compose before reading the guard", async () => {
    const queries = [];
    await assert.rejects(
      () =>
        assertIsolatedDatabase(
          {
            query: async (sql) => {
              queries.push(sql);
              return { rows: [{ system_identifier: "different" }] };
            },
          },
          options,
        ),
      /instance does not match/i,
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /pg_control_system/);
  });

  it("rejects a database whose guard differs from the run token", async () => {
    await assert.rejects(
      () => assertIsolatedDatabase(database(undefined, "different"), options),
      /guard does not match/i,
    );
  });

  it("accepts only a matching instance and guard", async () => {
    await assert.doesNotReject(() =>
      assertIsolatedDatabase(database(), options),
    );
  });
});
