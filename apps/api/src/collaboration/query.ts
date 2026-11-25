import type * as pg from "pg";
import type { Pool, PoolClient } from "pg";

/** Authorization can fail promptly, but its actual SQL remains drain-owned. */
export async function boundedQuery<
  Row extends pg.QueryResultRow = pg.QueryResultRow,
>(
  db: Pool | PoolClient,
  text: string,
  values: unknown[] = [],
  timeout = 2000,
  retain: (query: Promise<unknown>) => void = () => {},
) {
  const query = db.query<Row>({
    text,
    values,
    query_timeout: 0,
  } as pg.QueryConfig);
  retain(query);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database query timed out")),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
