import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { piazzaFixture } from "../piazza-import/fixture.js";
import { PiazzaImportService } from "../piazza-import/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `piazza_http_${process.pid}_${Date.now()}`;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
let admin: Pool;
let pool: Pool;
let actors: { id: string; email: string }[];
let activeActor = 0;

integration("Piazza JSON HTTP import with PostgreSQL", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    const org = await pool.query<{ id: string }>(
      "INSERT INTO organizations (id,domain,name) VALUES (gen_random_uuid(),'piazza-http.test','Test') RETURNING id",
    );
    actors = [];
    for (const name of ["owner", "other"]) {
      const email = `${name}@piazza-http.test`;
      const row = await pool.query<{ id: string }>(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES (gen_random_uuid(),$1,$2,$3,'x') RETURNING id",
        [org.rows[0]!.id, email, name],
      );
      actors.push({ id: row.rows[0]!.id, email });
    }
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  const app = () =>
    createApp({
      environment,
      authService: {
        session: async () => ({
          id: "session",
          user: actors[activeActor],
          csrfToken: "csrf",
        }),
      } as unknown as AuthService,
      piazzaImportService: new PiazzaImportService(pool),
    });
  const send = (data: unknown) =>
    request(app())
      .post("/api/v1/piazza-imports")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=opaque`)
      .set("X-CSRF-Token", "csrf")
      .attach("file", Buffer.from(JSON.stringify(data)), "class.json");

  it("imports retained public content without private-only identities and rejects non-instructor re-import", async () => {
    const invalid = await request(app())
      .post("/api/v1/piazza-imports")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=opaque`)
      .set("X-CSRF-Token", "csrf")
      .attach("file", Buffer.from("not JSON"), "class.json");
    expect(invalid.status).toBe(422);
    expect((await pool.query("SELECT id FROM courses")).rows).toHaveLength(0);
    const source = piazzaFixture();
    source.network.id = "http-test-class";
    source.users.push({
      id: "private-only",
      name: "Secret Person",
      role: "student",
    });
    source.posts.find((post) => post.status === "private")!.history[0]!.uid =
      "private-only";
    const imported = await send(source);
    expect(imported.status).toBe(200);
    expect(imported.headers.location).toBe(
      `/api/v1/courses/${imported.body.data.courseId}`,
    );
    expect(imported.body.data.omittedPrivatePosts).toBe(1);
    expect(imported.body.data.posts.created).toBe(3);
    const posts = await pool.query(
      "SELECT title,private FROM posts WHERE course_id=$1",
      [imported.body.data.courseId],
    );
    expect(posts.rows).toHaveLength(3);
    expect(posts.rows.every((post) => post.private === false)).toBe(true);
    const privatePerson = await pool.query(
      "SELECT id FROM users WHERE display_name='Secret Person'",
    );
    expect(privatePerson.rows).toHaveLength(0);
    activeActor = 1;
    const denied = await send(source);
    expect(denied.status).toBe(404);
    const membership = await pool.query(
      "SELECT user_id FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [imported.body.data.courseId, actors[1]!.id],
    );
    expect(membership.rows).toHaveLength(0);
    activeActor = 0;
    const updated = await send(source);
    expect(updated.status).toBe(200);
    expect(updated.body.data.courseId).toBe(imported.body.data.courseId);
    expect(updated.body.data.posts.created).toBe(0);
    expect(
      (
        await pool.query("SELECT id FROM posts WHERE course_id=$1", [
          imported.body.data.courseId,
        ])
      ).rows,
    ).toHaveLength(3);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [imported.body.data.courseId, actors[0]!.id],
    );
    const revoked = await send(source);
    expect(revoked.status).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT user_id FROM course_memberships WHERE course_id=$1 AND user_id=$2",
          [imported.body.data.courseId, actors[0]!.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
