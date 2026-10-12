import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { PostService, postEtag } from "../posts/service.js";
import { StatisticsService } from "../statistics/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `statistics_${process.pid}_${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  otherCourse: uuidv7(),
  student: uuidv7(),
  quiet: uuidv7(),
  staff: uuidv7(),
  outsider: uuidv7(),
};
let admin: Pool;
let pool: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "x@example.edu",
          displayName: "X",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
    answerService: new AnswerService(pool),
    statisticsService: new StatisticsService(pool),
  });
}
const read = (userId: string, path: string) =>
  request(app(userId))
    .get(path)
    .set("Cookie", "__Host-chalktalk_session=opaque");

integration("course statistics API", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [id, name] of [
      [ids.student, "Student"],
      [ids.quiet, "Quiet"],
      [ids.staff, "Staff"],
      [ids.outsider, "Outsider"],
    ])
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name.toLowerCase()}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH'),($4,$2,$3,'Chemistry','BCDEFGHI')",
      [ids.course, ids.org, ids.staff, ids.otherCourse],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($5,$4,'ta')",
      [ids.course, ids.student, ids.quiet, ids.staff, ids.otherCourse],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("records one view per viewer, post, and UTC day after successful canonical detail reads", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Why?','Body')",
      [postId, ids.course, ids.student],
    );
    expect((await read(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      200,
    );
    expect((await read(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      200,
    );
    expect((await read(ids.outsider, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );
    const events = await pool.query(
      "SELECT count(*)::int AS count FROM post_view_events WHERE post_id=$1",
      [postId],
    );
    expect(events.rows[0].count).toBe(1);
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [postId],
    );
    expect((await read(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      200,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM post_view_events WHERE post_id=$1",
          [postId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("records answer creation contribution in the answer transaction", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','How?','Body')",
      [postId, ids.course, ids.student],
    );
    const created = await request(app(ids.student))
      .post(`/api/v1/posts/${postId}/answers`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .send({ bodyMarkdown: "Because." });
    expect(created.status).toBe(201);
    const events = await pool.query(
      "SELECT user_id FROM answer_contribution_events WHERE answer_id=$1",
      [created.body.data.id],
    );
    expect(events.rows).toEqual([{ user_id: ids.student }]);
  });

  it("returns staff summary, creation-time response interval, and current students including zero activity", async () => {
    const postId = uuidv7();
    const answerId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'question','Time?','Body',now()-interval '2 hours')",
      [postId, ids.course, ids.student],
    );
    await pool.query(
      "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_at,endorsed_at,endorsed_by_user_id) VALUES ($1,$2,$3,'student','Answer',now()-interval '1 hour',now(),$4)",
      [answerId, ids.course, postId, ids.staff],
    );
    await pool.query(
      "INSERT INTO answer_contribution_events (course_id,answer_id,user_id,contributed_at) VALUES ($1,$2,$3,now()-interval '1 hour')",
      [ids.course, answerId, ids.student],
    );
    const summary = await read(
      ids.staff,
      `/api/v1/courses/${ids.course}/statistics?period=7d`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      courseId: ids.course,
      period: "7d",
      postsViewed: expect.any(Number),
      averageResponseTimeSeconds: expect.closeTo(3600, 0),
    });
    expect(summary.body.data.dailyActivity).toHaveLength(7);
    const students = await read(
      ids.staff,
      `/api/v1/courses/${ids.course}/statistics/students?period=7d&limit=1`,
    );
    expect(students.status).toBe(200);
    expect(students.body.page.hasMore).toBe(true);
    const next = await read(
      ids.staff,
      `/api/v1/courses/${ids.course}/statistics/students?period=7d&limit=1&cursor=${encodeURIComponent(students.body.page.nextCursor)}`,
    );
    expect(next.status).toBe(200);
    const rows = [...students.body.data, ...next.body.data];
    expect(
      rows.find((row: { user: { id: string } }) => row.user.id === ids.student),
    ).toMatchObject({
      questionsCreated: expect.any(Number),
      answersContributed: 2,
    });
    expect(
      rows.find((row: { user: { id: string } }) => row.user.id === ids.quiet),
    ).toMatchObject({
      questionsCreated: 0,
      answersContributed: 0,
      postsViewed: 0,
    });
  });

  it("retains a student's question count after soft deletion", async () => {
    const service = new StatisticsService(pool);
    const before = await service.students(ids.course, ids.staff, "7d", 100);
    const countBefore = before.data.find(
      (row) => row.user.id === ids.student,
    )!.questionsCreated;
    const posts = new PostService(pool);
    const post = await posts.create(ids.course, ids.student, {
      type: "question",
      title: "Temporary question",
      bodyMarkdown: "Body",
    });
    const afterCreate = await service.students(
      ids.course,
      ids.staff,
      "7d",
      100,
    );
    expect(
      afterCreate.data.find((row) => row.user.id === ids.student)!
        .questionsCreated,
    ).toBe(countBefore + 1);
    await posts.delete(post.value.id, ids.student, postEtag(post.value));
    const afterDelete = await service.students(
      ids.course,
      ids.staff,
      "7d",
      100,
    );
    expect(
      afterDelete.data.find((row) => row.user.id === ids.student)!
        .questionsCreated,
    ).toBe(countBefore + 1);
    const stored = await pool.query(
      "SELECT course_id,user_id,created_on,question_count FROM question_creation_daily_counts WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.student],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].question_count).toBeGreaterThanOrEqual(1);
  });

  it("enforces staff access and validates period and scoped cursor", async () => {
    const base = `/api/v1/courses/${ids.course}/statistics`;
    expect((await read(ids.student, base)).status).toBe(403);
    expect((await read(ids.outsider, base)).status).toBe(404);
    expect((await read(ids.staff, `${base}?period=bad`)).status).toBe(400);
    expect((await read(ids.staff, `${base}/students?limit=0`)).status).toBe(
      400,
    );
    const first = await read(ids.staff, `${base}/students?period=7d&limit=1`);
    expect(
      (
        await read(
          ids.staff,
          `/api/v1/courses/${ids.otherCourse}/statistics/students?period=7d&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    const malformed = Buffer.from(
      JSON.stringify({
        courseId: ids.course,
        period: "7d",
        name: "Ada",
        id: "bad",
      }),
    ).toString("base64url");
    expect(
      (await read(ids.staff, `${base}/students?period=7d&cursor=${malformed}`))
        .status,
    ).toBe(400);
  });

  it("keeps student pagination stable when a remaining student changes their name", async () => {
    const path = `/api/v1/courses/${ids.course}/statistics/students?limit=1`;
    const first = await read(ids.staff, path);
    expect(first.status).toBe(200);
    expect(first.body.page.hasMore).toBe(true);
    const remainingId =
      first.body.data[0].user.id === ids.student ? ids.quiet : ids.student;
    try {
      await pool.query("UPDATE users SET display_name='Aaron' WHERE id=$1", [
        remainingId,
      ]);
      const second = await read(
        ids.staff,
        `${path}&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
      );
      expect(second.status).toBe(200);
      expect(
        second.body.data.map((row: { user: { id: string } }) => row.user.id),
      ).toEqual([remainingId]);
    } finally {
      await pool.query("UPDATE users SET display_name=$2 WHERE id=$1", [
        remainingId,
        remainingId === ids.quiet ? "Quiet" : "Student",
      ]);
    }
  });

  it("returns service_unavailable when statistics storage fails", async () => {
    const broken = new StatisticsService({
      query: async () => {
        throw new Error("database unavailable");
      },
    } as unknown as Pool);
    const response = await request(
      createApp({
        environment,
        authService: {
          session: async () => ({
            id: uuidv7(),
            user: {
              id: ids.staff,
              email: "staff@example.edu",
              displayName: "Staff",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1,
            },
            expiresAt: new Date().toISOString(),
            csrfToken: "csrf",
          }),
        } as AuthService,
        statisticsService: broken,
      }),
    )
      .get(`/api/v1/courses/${ids.course}/statistics`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("service_unavailable");
  });
});
