import { Pool } from "pg";
import {
  getMigrationDirectory,
  runMigrations,
} from "../../../apps/api/src/database/migrate.js";
import { seedAms161 } from "../../../apps/api/src/database/seed-ams161.js";

const schema = `seed_math_browser_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `--search_path="${schema}"`,
});
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await runMigrations(pool, getMigrationDirectory());
  await seedAms161(pool, {
    MOCK_DATA: "true",
    AMS161_DEMO_INSTRUCTOR_PASSWORD: "browser seed password 123",
  });
  const readBodies = async () =>
    (
      await pool.query(`SELECT p.body_markdown AS question,a.body_markdown AS answer
    FROM posts p JOIN answers a ON a.post_id=p.id
    WHERE p.title='How do I parametrize an arc length problem?' AND a.kind='student'`)
    ).rows[0];
  const fresh = await readBodies();
  await pool.query(
    "UPDATE posts SET body_markdown=$1 WHERE title='How do I parametrize an arc length problem?'",
    [
      "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?",
    ],
  );
  await pool.query(
    "UPDATE answers SET body_markdown=$1 WHERE post_id=(SELECT id FROM posts WHERE title='How do I parametrize an arc length problem?') AND kind='student'",
    [
      "Think of a tiny piece of the curve as the hypotenuse of a right triangle with legs dx and dy. Its length is sqrt(dx^2 + dy^2) = sqrt(1 + (dy/dx)^2) dx.",
    ],
  );
  // This fixture emits only JSON; seed's operational counts are covered separately.
  console.info = () => {};
  await seedAms161(pool, {
    MOCK_DATA: "true",
    AMS161_DEMO_INSTRUCTOR_PASSWORD: "browser seed password 123",
  });
  const repaired = await readBodies();
  process.stdout.write(JSON.stringify({ fresh, repaired }));
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
