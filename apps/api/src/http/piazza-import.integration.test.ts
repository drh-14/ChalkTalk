import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { convertExport } from "../piazza-import/convert.js";
import { piazzaFixture } from "../piazza-import/fixture.js";
import { importPiazzaCourse, piazzaEmail } from "../piazza-import/importer.js";
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

  it("keeps a file-reported exporter separate from the uploader on import and re-import", async () => {
    activeActor = 0;
    const source = piazzaFixture();
    source.network.id = "http-exporter-class";
    source.posts[0]!.history[0]!.uid = source.selfUid!;
    source.posts[1]!.children![0]!.history![0]!.uid = source.selfUid!;
    const first = await send(source);
    expect(first.status).toBe(200);
    const courseId = first.body.data.courseId;
    const exporter = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1",
      [piazzaEmail("Me Myself", source.selfUid!)],
    );
    expect(exporter.rows).toHaveLength(1);
    const exporterId = exporter.rows[0]!.id;
    expect(exporterId).not.toBe(actors[0]!.id);
    expect(
      (
        await pool.query("SELECT created_by_user_id FROM courses WHERE id=$1", [
          courseId,
        ])
      ).rows[0]!.created_by_user_id,
    ).toBe(actors[0]!.id);
    const attributed = async () => ({
      posts: (
        await pool.query(
          "SELECT author_user_id FROM posts WHERE course_id=$1 AND title='Welcome & syllabus'",
          [courseId],
        )
      ).rows[0]!.author_user_id,
      answer: (
        await pool.query(
          "SELECT created_by_user_id FROM answers WHERE course_id=$1 AND kind='student'",
          [courseId],
        )
      ).rows[0]!.created_by_user_id,
      followup: (
        await pool.query(
          "SELECT author_user_id FROM followups WHERE course_id=$1 AND body_markdown='What about three loops?'",
          [courseId],
        )
      ).rows[0]!.author_user_id,
    });
    expect(await attributed()).toEqual({
      posts: exporterId,
      answer: exporterId,
      followup: exporterId,
    });

    source.posts.push({
      id: "exporter-new-post",
      type: "note",
      status: "active",
      created: "2026-09-12T00:00:00Z",
      history: [
        {
          uid: source.selfUid!,
          anon: "no",
          subject: "Exporter new note",
          content: "More",
          created: "2026-09-12T00:00:00Z",
        },
      ],
    });
    const second = await send(source);
    expect(second.status).toBe(200);
    expect(second.body.data.courseId).toBe(courseId);
    expect(second.body.data.posts.created).toBe(1);
    expect(await attributed()).toEqual({
      posts: exporterId,
      answer: exporterId,
      followup: exporterId,
    });
    expect(
      (
        await pool.query(
          "SELECT author_user_id FROM posts WHERE course_id=$1 AND title='Exporter new note'",
          [courseId],
        )
      ).rows[0]!.author_user_id,
    ).toBe(exporterId);
  });

  it("preserves CLI attribution on UI re-import while assigning new content to the exporter", async () => {
    activeActor = 0;
    const source = piazzaFixture();
    source.network.id = "http-cli-then-ui-class";
    source.posts[0]!.history[0]!.uid = source.selfUid!;
    for (const entry of source.posts[1]!.history) {
      entry.anon = "no";
      entry.uid = source.selfUid!;
    }
    source.posts[1]!.children![0]!.history![0]!.uid = source.selfUid!;
    const cli = await importPiazzaCourse(pool, convertExport(source), {
      ownerEmail: actors[0]!.email,
    });
    const existing = async () => ({
      posts: (
        await pool.query(
          "SELECT title,author_user_id FROM posts WHERE course_id=$1 AND title IN ('Welcome & syllabus','How does $$O(n^2)$$ arise?') ORDER BY title",
          [cli.courseId],
        )
      ).rows,
      follows: (
        await pool.query(
          "SELECT p.title,f.user_id FROM post_follows f JOIN posts p ON p.id=f.post_id WHERE p.course_id=$1 AND p.title IN ('Welcome & syllabus','How does $$O(n^2)$$ arise?') ORDER BY p.title",
          [cli.courseId],
        )
      ).rows,
      answers: (
        await pool.query(
          "SELECT a.created_by_user_id,c.user_id AS contributor,e.user_id AS activity_user FROM answers a JOIN posts p ON p.id=a.post_id JOIN answer_contributors c ON c.answer_id=a.id JOIN answer_contribution_events e ON e.answer_id=a.id AND e.user_id=c.user_id WHERE p.course_id=$1 AND p.title='How does $$O(n^2)$$ arise?' AND a.kind='student'",
          [cli.courseId],
        )
      ).rows,
      followups: (
        await pool.query(
          "SELECT author_user_id FROM followups WHERE course_id=$1 AND body_markdown='What about three loops?'",
          [cli.courseId],
        )
      ).rows,
      questionActivity: (
        await pool.query(
          "SELECT user_id,question_count FROM question_creation_daily_counts WHERE course_id=$1 AND user_id=$2 AND created_on='2026-09-02'",
          [cli.courseId, actors[0]!.id],
        )
      ).rows,
    });
    const before = await existing();
    expect(before.posts).toHaveLength(2);
    expect(
      before.posts.every((row) => row.author_user_id === actors[0]!.id),
    ).toBe(true);
    expect(before.answers).toEqual([
      {
        created_by_user_id: actors[0]!.id,
        contributor: actors[0]!.id,
        activity_user: actors[0]!.id,
      },
    ]);
    expect(before.followups).toEqual([{ author_user_id: actors[0]!.id }]);
    expect(before.questionActivity).toHaveLength(1);

    const created = "2026-09-12T00:00:00Z";
    source.posts.push({
      id: "new-exporter-question",
      type: "question",
      status: "active",
      created,
      history: [
        {
          uid: source.selfUid!,
          anon: "no",
          subject: "New exporter question",
          content: "New body",
          created,
        },
      ],
      children: [
        {
          id: "new-exporter-answer",
          type: "s_answer",
          created,
          history: [
            {
              uid: source.selfUid!,
              anon: "no",
              content: "New answer",
              created,
            },
          ],
        },
        {
          id: "new-exporter-followup",
          type: "followup",
          uid: source.selfUid!,
          anon: "no",
          subject: "New followup",
          created,
          no_answer: 1,
        },
      ],
    });
    const response = await send(source);
    expect(response.status).toBe(200);
    expect(response.body.data.courseId).toBe(cli.courseId);
    expect(response.body.data).toMatchObject({
      posts: { created: 1 },
      answers: { created: 1 },
      followups: { created: 1 },
    });
    expect(await existing()).toEqual(before);
    const exporter = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1",
      [piazzaEmail("Me Myself", source.selfUid!)],
    );
    expect(exporter.rows).toHaveLength(1);
    const exporterId = exporter.rows[0]!.id;
    expect(exporterId).not.toBe(actors[0]!.id);
    const newer = await pool.query(
      "SELECT p.author_user_id,a.created_by_user_id,f.author_user_id AS followup_author FROM posts p JOIN answers a ON a.post_id=p.id JOIN followups f ON f.post_id=p.id WHERE p.course_id=$1 AND p.title='New exporter question'",
      [cli.courseId],
    );
    expect(newer.rows).toEqual([
      {
        author_user_id: exporterId,
        created_by_user_id: exporterId,
        followup_author: exporterId,
      },
    ]);
    const activity = await pool.query(
      "SELECT c.user_id AS contributor,e.user_id AS activity_user FROM answer_contributors c JOIN answer_contribution_events e ON e.answer_id=c.answer_id AND e.user_id=c.user_id JOIN answers a ON a.id=c.answer_id JOIN posts p ON p.id=a.post_id WHERE p.course_id=$1 AND p.title='New exporter question'",
      [cli.courseId],
    );
    expect(activity.rows).toEqual([
      { contributor: exporterId, activity_user: exporterId },
    ]);
  });
});
