import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { StatisticsService } from "../statistics/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `pulse_${process.pid}_${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  empty: uuidv7(),
  student: uuidv7(),
  quiet: uuidv7(),
  staff: uuidv7(),
  outsider: uuidv7(),
};
let admin: Pool;
let pool: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
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
    statisticsService: new StatisticsService(pool),
  });
}
const pulse = (userId: string, courseId: string, query = "") =>
  request(app(userId))
    .get(`/api/v1/courses/${courseId}/statistics/pulse${query}`)
    .set("Cookie", "__Host-chalktalk_session=opaque");

async function question(createdAt: string, tags: string[] = []) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'question','Why?','Body',$4)",
    [id, ids.course, ids.student, createdAt],
  );
  for (const name of tags)
    await pool.query(
      `WITH tag AS (
        INSERT INTO tags (id,course_id,name) VALUES ($1,$2,$3)
        ON CONFLICT (course_id,name) DO UPDATE SET name=EXCLUDED.name
        RETURNING id
      ) INSERT INTO post_tags (post_id,tag_id) SELECT $4,id FROM tag`,
      [uuidv7(), ids.course, name, id],
    );
  return id;
}
async function answer(
  postId: string,
  kind: "student" | "staff",
  userId: string,
  createdAt: string,
  anonymous = false,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor,anonymous,created_at) VALUES ($1,$2,$3,$4,'Answer',$5,$6,$7,$8)",
    [
      id,
      ids.course,
      postId,
      kind,
      userId,
      kind === "staff" ? "ta" : "student",
      anonymous,
      createdAt,
    ],
  );
  await pool.query(
    "INSERT INTO answer_contribution_events (course_id,answer_id,user_id,contributed_at) VALUES ($1,$2,$3,$4)",
    [ids.course, id, userId, createdAt],
  );
}

integration("course pulse API", () => {
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
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Imported','ABCDEFGH'),($4,$2,$3,'Empty','BCDEFGHI')",
      [ids.course, ids.org, ids.staff, ids.empty],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($5,$4,'instructor')",
      [ids.course, ids.student, ids.quiet, ids.staff, ids.empty],
    );
    // A Fall 2024 semester. In New York (UTC-4 until November 3) the first two
    // questions are Tuesday 10:30 and 11:10; the third is Monday 22:00, which
    // is already Tuesday in UTC.
    const first = await question("2024-09-03T14:30:00Z", ["hw1"]);
    const second = await question("2024-09-03T15:10:00Z", ["hw1"]);
    await question("2024-09-24T02:00:00Z", ["hw2"]);
    await answer(first, "student", ids.student, "2024-09-03T15:30:00Z");
    await answer(first, "staff", ids.staff, "2024-09-03T16:00:00Z");
    await answer(second, "student", ids.quiet, "2024-09-03T15:40:00Z", true);
    // Notes, deleted questions, and deleted answers never count.
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'note','Notes','Body','2024-09-10T14:00:00Z')",
      [uuidv7(), ids.course, ids.staff],
    );
    await pool.query(
      "INSERT INTO posts (id,course_id,type,deleted_at,created_at) VALUES ($1,$2,'question',now(),'2024-10-15T14:00:00Z')",
      [uuidv7(), ids.course],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("summarizes an imported semester for staff in their time zone", async () => {
    const response = await pulse(
      ids.staff,
      ids.course,
      "?timeZone=America/New_York",
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    const body = response.body.data;
    expect(body).toMatchObject({
      courseId: ids.course,
      timeZone: "America/New_York",
      firstQuestionAt: "2024-09-03T14:30:00.000Z",
      lastQuestionAt: "2024-09-24T02:00:00.000Z",
      questions: 3,
      answered: 2,
      unanswered: 1,
      medianFirstAnswerMinutes: 45,
    });
    expect(body.hours).toHaveLength(7);
    expect(body.hours.every((row: number[]) => row.length === 24)).toBe(true);
    expect(body.hours[2][10]).toBe(1);
    expect(body.hours[2][11]).toBe(1);
    expect(body.hours[1][22]).toBe(1);
    expect(body.hours.flat().reduce((a: number, b: number) => a + b)).toBe(3);
    expect(body.weeks).toEqual([
      { weekStart: "2024-09-01", questions: 2 },
      { weekStart: "2024-09-08", questions: 0 },
      { weekStart: "2024-09-15", questions: 0 },
      { weekStart: "2024-09-22", questions: 1 },
    ]);
    expect(body.topics).toEqual([
      { tag: "hw1", questions: 2, unanswered: 0, medianFirstAnswerMinutes: 45 },
      {
        tag: "hw2",
        questions: 1,
        unanswered: 1,
        medianFirstAnswerMinutes: null,
      },
    ]);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("keeps anonymous answers out of helpers and ranks ties by name", async () => {
    const response = await pulse(ids.staff, ids.course);
    expect(response.body.data.helpers).toEqual([
      { userId: ids.staff, displayName: "Staff", role: "ta", answers: 1 },
      {
        userId: ids.student,
        displayName: "Student",
        role: "student",
        answers: 1,
      },
    ]);
  });

  it("buckets in UTC when no time zone is given", async () => {
    const response = await pulse(ids.staff, ids.course);
    expect(response.status).toBe(200);
    expect(response.body.data.timeZone).toBe("UTC");
    expect(response.body.data.hours[2][14]).toBe(1);
    expect(response.body.data.hours[2][15]).toBe(1);
    expect(response.body.data.hours[2][2]).toBe(1);
    expect(response.body.data.hours[1][22]).toBe(0);
  });

  it("returns empty totals for a course without questions", async () => {
    const response = await pulse(ids.staff, ids.empty);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      firstQuestionAt: null,
      lastQuestionAt: null,
      questions: 0,
      answered: 0,
      unanswered: 0,
      medianFirstAnswerMinutes: null,
      weeks: [],
      topics: [],
      helpers: [],
    });
  });

  it("rejects students, non-members, and unknown time zones", async () => {
    const student = await pulse(ids.student, ids.course);
    expect(student.status).toBe(403);
    expect(student.body.error.code).toBe("permission_denied");
    expect(student.body).not.toHaveProperty("data");
    const outsider = await pulse(ids.outsider, ids.course);
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("not_found");
    expect((await pulse(ids.staff, uuidv7())).status).toBe(404);
    const zone = await pulse(ids.staff, ids.course, "?timeZone=Mars/Olympus");
    expect(zone.status).toBe(400);
    expect(zone.body.error.code).toBe("invalid_request");
    const long = await pulse(
      ids.staff,
      ids.course,
      `?timeZone=${"A".repeat(65)}`,
    );
    expect(long.status).toBe(400);
  });
});
