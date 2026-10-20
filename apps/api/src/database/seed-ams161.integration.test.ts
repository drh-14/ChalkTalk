import { Pool } from "pg";
import katex from "katex";
import { version as uuidVersion } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";
import { seedAms161, AMS161_DEMO, AMS161_FIXTURE } from "./seed-ams161.js";
import { CourseService } from "../courses/service.js";
import { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { PostService } from "../posts/service.js";
import { StatisticsService } from "../statistics/service.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `ams161_seed_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const password = "local demo password 123";
const studentPassword = "local student password 456";
const studentEmail = "riley.nguyen@ams161.mock.chalktalk.invalid";

it("uses a non-placeholder UUIDv7 for the AMS161 course", () => {
  expect(uuidVersion(AMS161_DEMO.courseId)).toBe(7);
  expect(AMS161_DEMO.courseId).not.toBe("a1610000-0000-7000-8000-000000000002");
});

it("uses a non-placeholder UUIDv7 for the AMS161 organization", () => {
  expect(uuidVersion(AMS161_DEMO.organizationId)).toBe(7);
  expect(AMS161_DEMO.organizationId).not.toBe(
    "a1610000-0000-7000-8000-000000000001",
  );
});

integration("AMS161 local prototype seed", () => {
  it("reserves UUIDv7 fixture identifiers and a non-deliverable email domain", () => {
    expect(uuidVersion(AMS161_DEMO.organizationId)).toBe(7);
    expect(AMS161_DEMO.organizationDomain).toBe(
      "ams161.mock.chalktalk.invalid",
    );
    expect(AMS161_DEMO.instructorEmail).toBe(
      "maya.chen@ams161.mock.chalktalk.invalid",
    );
  });
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("does not write or need a password when mock data is disabled", async () => {
    expect(await seedAms161(pool, { MOCK_DATA: "false" })).toBe("disabled");
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM organizations",
    );
    expect(result.rows[0].count).toBe(0);
  });

  it("rejects missing and weak enabled passwords without writing", async () => {
    await expect(seedAms161(pool, { MOCK_DATA: "true" })).rejects.toThrow(
      /AMS161_DEMO_INSTRUCTOR_PASSWORD/,
    );
    await expect(
      seedAms161(pool, {
        MOCK_DATA: "true",
        AMS161_DEMO_INSTRUCTOR_PASSWORD: "short",
      }),
    ).rejects.toThrow(/AMS161_DEMO_INSTRUCTOR_PASSWORD/);
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM organizations",
    );
    expect(result.rows[0].count).toBe(0);
  });

  it.each(["", "short", "x".repeat(129)])(
    "rejects invalid optional student password before writing",
    async (invalid) => {
      await expect(
        seedAms161(pool, {
          MOCK_DATA: "true",
          AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
          AMS161_DEMO_STUDENT_PASSWORD: invalid,
        }),
      ).rejects.toThrow(/AMS161_DEMO_STUDENT_PASSWORD/);
      expect(
        (await pool.query("SELECT count(*)::int AS count FROM users")).rows[0]
          .count,
      ).toBe(0);
    },
  );

  it("creates course members and a varied discussion with no merged posts", async () => {
    expect(
      await seedAms161(pool, {
        MOCK_DATA: "true",
        AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
        AMS161_DEMO_STUDENT_PASSWORD: studentPassword,
      }),
    ).toBe("created");
    const course = await pool.query(
      "SELECT name,join_code FROM courses WHERE id=$1",
      [AMS161_DEMO.courseId],
    );
    expect(course.rows[0]).toEqual({
      name: "AMS161",
      join_code: AMS161_DEMO.joinCode,
    });
    const members = await pool.query(
      "SELECT role,display_name FROM course_memberships JOIN users ON users.id=user_id WHERE course_id=$1 ORDER BY role,display_name",
      [AMS161_DEMO.courseId],
    );
    expect(members.rows).toEqual([
      { role: "instructor", display_name: "Maya Chen" },
      { role: "student", display_name: "Alex Rivera" },
      { role: "student", display_name: "Casey Morgan" },
      { role: "student", display_name: "Jordan Patel" },
      { role: "student", display_name: "Riley Nguyen" },
      { role: "student", display_name: "Taylor Brooks" },
      { role: "ta", display_name: "Sam Okafor" },
    ]);
    const posts = await pool.query(
      "SELECT duplicate_status, count(*)::int AS count FROM posts WHERE course_id=$1 GROUP BY duplicate_status ORDER BY duplicate_status",
      [AMS161_DEMO.courseId],
    );
    expect(posts.rows).toEqual([
      { duplicate_status: "none", count: AMS161_FIXTURE.posts },
    ]);
    const targetCount = await pool.query(
      "SELECT count(*)::int AS count FROM posts WHERE course_id=$1 AND duplicate_of_post_id IS NOT NULL",
      [AMS161_DEMO.courseId],
    );
    expect(targetCount.rows[0].count).toBe(0);
    const shape = await pool.query(
      "SELECT count(*) FILTER (WHERE type='question')::int AS questions, count(*) FILTER (WHERE type='note')::int AS notes, count(*) FILTER (WHERE anonymous)::int AS anonymous, bool_and(created_at<=last_activity_at AND last_activity_at<=now()) AS ordered, bool_or(created_at<now()-interval '90 days') AS old, bool_or(created_at>now()-interval '1 hour') AS recent FROM posts WHERE course_id=$1",
      [AMS161_DEMO.courseId],
    );
    expect(shape.rows[0]).toEqual({
      questions: AMS161_FIXTURE.questions,
      notes: AMS161_FIXTURE.notes,
      anonymous: 2,
      ordered: true,
      old: true,
      recent: true,
    });
    const answers = await pool.query(
      "SELECT a.kind, count(*)::int AS count, count(a.endorsed_at)::int AS endorsed, bool_and(a.created_at>=p.created_at) AS after_post, bool_and(c.answer_id IS NOT NULL) AS contributed FROM answers a JOIN posts p ON p.id=a.post_id JOIN answer_contributors c ON c.answer_id=a.id WHERE a.course_id=$1 GROUP BY a.kind ORDER BY a.kind",
      [AMS161_DEMO.courseId],
    );
    expect(answers.rows).toEqual([
      {
        kind: "staff",
        count: 7,
        endorsed: 0,
        after_post: true,
        contributed: true,
      },
      {
        kind: "student",
        count: 5,
        endorsed: 1,
        after_post: true,
        contributed: true,
      },
    ]);
  });

  it("authenticates the dedicated demo student and grants student AMS161 access", async () => {
    const auth = new AuthService(
      pool,
      loadEnvironment({
        AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      }),
      { send: async () => {} },
    );
    const { session } = await auth.login(studentEmail, studentPassword);
    expect(session.user.displayName).toBe("Riley Nguyen");
    const courses = new CourseService(pool);
    expect(
      (await courses.get(AMS161_DEMO.courseId, session.user.id)).name,
    ).toBe("AMS161");
    expect(
      (
        await courses.getMember(
          AMS161_DEMO.courseId,
          session.user.id,
          session.user.id,
        )
      ).role,
    ).toBe("student");
  });

  it("preserves the dedicated student's original password and edited identity on repeats", async () => {
    const original = (
      await pool.query(
        "SELECT id,password_hash,version FROM users WHERE email=$1",
        [studentEmail],
      )
    ).rows[0];
    await pool.query(
      "UPDATE users SET display_name='Riley edited' WHERE id=$1",
      [original.id],
    );
    const source = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
      AMS161_DEMO_STUDENT_PASSWORD: "different student password 789",
    };
    await Promise.all([seedAms161(pool, source), seedAms161(pool, source)]);
    const current = (
      await pool.query(
        "SELECT id,password_hash,version,display_name FROM users WHERE email=$1",
        [studentEmail],
      )
    ).rows[0];
    expect(current).toEqual({ ...original, display_name: "Riley edited" });
    const auth = new AuthService(
      pool,
      loadEnvironment({
        AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      }),
      { send: async () => {} },
    );
    await expect(
      auth.login(studentEmail, studentPassword),
    ).resolves.toBeTruthy();
    await expect(
      auth.login(studentEmail, source.AMS161_DEMO_STUDENT_PASSWORD),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM course_memberships WHERE user_id=$1 AND course_id=$2",
          [original.id, AMS161_DEMO.courseId],
        )
      ).rows[0].count,
    ).toBe(1);
    await pool.query(
      "UPDATE users SET display_name='Riley Nguyen' WHERE id=$1",
      [original.id],
    );
  });

  it("reports original-period student activity without inventing views", async () => {
    const instructor = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1",
      [AMS161_DEMO.instructorEmail],
    );
    const result = await new StatisticsService(pool).students(
      AMS161_DEMO.courseId,
      instructor.rows[0]!.id,
      "30d",
      100,
    );
    expect(
      result.data
        .map(({ user, questionsCreated, answersContributed, postsViewed }) => ({
          name: user.displayName,
          questionsCreated,
          answersContributed,
          postsViewed,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      {
        name: "Alex Rivera",
        questionsCreated: 5,
        answersContributed: 0,
        postsViewed: 0,
      },
      {
        name: "Casey Morgan",
        questionsCreated: 2,
        answersContributed: 1,
        postsViewed: 0,
      },
      {
        name: "Jordan Patel",
        questionsCreated: 3,
        answersContributed: 1,
        postsViewed: 0,
      },
      {
        name: "Riley Nguyen",
        questionsCreated: 0,
        answersContributed: 0,
        postsViewed: 0,
      },
      {
        name: "Taylor Brooks",
        questionsCreated: 3,
        answersContributed: 1,
        postsViewed: 0,
      },
    ]);
  });

  it("renders every emitted fixture math expression without invalid LaTeX", async () => {
    const rows = await pool.query<{ body_markdown: string }>(
      "SELECT body_markdown FROM posts UNION ALL SELECT body_markdown FROM answers",
    );
    const expressions = rows.rows.flatMap((row) =>
      [...row.body_markdown.matchAll(/\$([^$]+)\$/g)].map((match) => match[1]!),
    );
    expect(expressions.length).toBeGreaterThan(30);
    for (const expression of expressions) {
      expect(
        katex.renderToString(expression, { throwOnError: true, trust: false }),
      ).toContain('class="katex"');
    }
  });

  it("repairs an untracked legacy demo exactly once without changing persisted content", async () => {
    await pool.query(
      "DELETE FROM question_creation_daily_counts WHERE course_id=$1",
      [AMS161_DEMO.courseId],
    );
    await pool.query(
      "DELETE FROM answer_contribution_events WHERE course_id=$1",
      [AMS161_DEMO.courseId],
    );
    const before = await pool.query(
      "SELECT id,title,body_markdown FROM posts ORDER BY id",
    );
    const values = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    };
    expect(await seedAms161(pool, values)).toBe("already-seeded");
    const counts = await pool.query(`SELECT
      (SELECT sum(question_count)::int FROM question_creation_daily_counts) AS questions,
      (SELECT count(*)::int FROM answer_contribution_events) AS contributions,
      (SELECT count(*)::int FROM post_view_events) AS views`);
    expect(counts.rows[0]).toEqual({
      questions: 17,
      contributions: 12,
      views: 0,
    });
    expect(
      (await pool.query("SELECT id,title,body_markdown FROM posts ORDER BY id"))
        .rows,
    ).toEqual(before.rows);
    await Promise.all([seedAms161(pool, values), seedAms161(pool, values)]);
    expect(
      (
        await pool.query(`SELECT
      (SELECT sum(question_count)::int FROM question_creation_daily_counts) AS questions,
      (SELECT count(*)::int FROM answer_contribution_events) AS contributions,
      (SELECT count(*)::int FROM post_view_events) AS views`)
      ).rows,
    ).toEqual(counts.rows);
    expect(
      (
        await pool.query(`SELECT count(*)::int AS mismatches FROM answer_contribution_events e
      JOIN answers a ON a.id=e.answer_id WHERE e.contributed_at<>a.created_at`)
      ).rows[0].mismatches,
    ).toBe(0);
  });

  it("rolls back a failed legacy statistics repair without partial counts", async () => {
    await pool.query("DELETE FROM question_creation_daily_counts");
    await pool.query("DELETE FROM answer_contribution_events");
    await pool.query(
      "CREATE FUNCTION fail_statistics_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced statistics insert failure'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_statistics_repair BEFORE INSERT ON answer_contribution_events FOR EACH ROW EXECUTE FUNCTION fail_statistics_repair()",
    );
    try {
      await expect(
        seedAms161(pool, {
          MOCK_DATA: "true",
          AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
        }),
      ).rejects.toThrow("forced statistics insert failure");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM question_creation_daily_counts",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM answer_contribution_events",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await pool.query(
        "DROP TRIGGER fail_statistics_repair ON answer_contribution_events",
      );
      await pool.query("DROP FUNCTION fail_statistics_repair()");
    }
    await seedAms161(pool, {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    });
  });

  it("preserves historical counts and does not guess a partial statistics repair", async () => {
    const snapshot = await pool.query(
      "SELECT * FROM question_creation_daily_counts ORDER BY user_id,created_on",
    );
    await pool.query(
      "UPDATE question_creation_daily_counts SET question_count=question_count+7 WHERE (course_id,user_id,created_on)=(SELECT course_id,user_id,created_on FROM question_creation_daily_counts LIMIT 1)",
    );
    await pool.query(
      "DELETE FROM answer_contribution_events WHERE course_id=$1",
      [AMS161_DEMO.courseId],
    );
    const historical = await pool.query(
      "SELECT * FROM question_creation_daily_counts ORDER BY user_id,created_on",
    );
    await seedAms161(pool, {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM question_creation_daily_counts ORDER BY user_id,created_on",
        )
      ).rows,
    ).toEqual(historical.rows);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM answer_contribution_events",
        )
      ).rows[0].count,
    ).toBe(0);
    // Restore this shared fixture for the existing downstream seed tests.
    await pool.query("DELETE FROM question_creation_daily_counts");
    await seedAms161(pool, {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM question_creation_daily_counts ORDER BY user_id,created_on",
        )
      ).rows,
    ).toEqual(snapshot.rows);
  });

  it("lets the instructor log in while mock students have no shared usable credential", async () => {
    const auth = new AuthService(
      pool,
      loadEnvironment({
        AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      }),
      { send: async () => {} },
    );
    const login = await auth.login(AMS161_DEMO.instructorEmail, password);
    expect(login.session.user.displayName).toBe("Maya Chen");
    await expect(
      auth.login("alex.rivera@ams161.mock.chalktalk.invalid", password),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("shows all seeded posts in the student feed with filters and searchable candidate pairs while staff review starts empty", async () => {
    const student = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email='alex.rivera@ams161.mock.chalktalk.invalid'",
    );
    const instructor = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1",
      [AMS161_DEMO.instructorEmail],
    );
    const posts = new PostService(pool);
    const ordinary = await posts.list(
      AMS161_DEMO.courseId,
      student.rows[0]!.id,
      { limit: 30, sort: "recent_activity" },
    );
    expect(ordinary.data).toHaveLength(AMS161_FIXTURE.posts);
    expect(ordinary.data.every((post) => post.duplicateStatus === "none")).toBe(
      true,
    );
    const list = async (options: Parameters<PostService["list"]>[2]) =>
      (
        await posts.list(AMS161_DEMO.courseId, student.rows[0]!.id, {
          limit: 30,
          sort: "recent_activity",
          ...options,
        })
      ).data;
    expect(await list({ type: "note" })).toHaveLength(AMS161_FIXTURE.notes);
    expect(
      (await list({ pinned: true })).map((post) => post.title).sort(),
    ).toEqual([
      "Is the final exam cumulative?",
      "Midterm 1: what to expect",
      "Welcome to AMS161: how to use this forum",
    ]);
    expect(await list({ type: "question", answered: true })).toHaveLength(10);
    expect(await list({ type: "question", answered: false })).toHaveLength(
      AMS161_FIXTURE.questions - 10,
    );
    expect(await list({ authorRole: "ta" })).toHaveLength(1);
    expect(
      (await list({ tags: ["midterm"] })).map((post) => post.title).sort(),
    ).toEqual(["Midterm 1: what to expect", "Series tests cheat sheet"]);
    const washerSearch = await posts.list(
      AMS161_DEMO.courseId,
      student.rows[0]!.id,
      { limit: 30, sort: "relevance", q: "washer" },
    );
    expect(washerSearch.data.map((post) => post.title)).toEqual(
      expect.arrayContaining([
        "How do I set up a disk or washer volume?",
        "Volume by washers around the x axis",
      ]),
    );
    const review = await posts.list(
      AMS161_DEMO.courseId,
      instructor.rows[0]!.id,
      { limit: 30, sort: "recent_activity", duplicateStatus: "confirmed" },
    );
    expect(review.data).toHaveLength(0);
  });

  it("is safe on repeated and concurrent startup and preserves instructor password and edited posts", async () => {
    const original = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email=$1",
      [AMS161_DEMO.instructorEmail],
    );
    await pool.query(
      "UPDATE posts SET title='Edited by reviewer' WHERE course_id=$1 AND title='Does the harmonic series converge?'",
      [AMS161_DEMO.courseId],
    );
    const values = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: "a different password 123",
    };
    expect(
      await Promise.all([seedAms161(pool, values), seedAms161(pool, values)]),
    ).toEqual(["already-seeded", "already-seeded"]);
    const updated = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email=$1",
      [AMS161_DEMO.instructorEmail],
    );
    expect(updated.rows[0]!.password_hash).toBe(
      original.rows[0]!.password_hash,
    );
    const edited = await pool.query(
      "SELECT count(*)::int AS count FROM posts WHERE course_id=$1 AND title='Edited by reviewer'",
      [AMS161_DEMO.courseId],
    );
    expect(edited.rows[0].count).toBe(1);
  });

  it("adds the dedicated login to an existing complete demo without resetting accounts", async () => {
    const name = `${schema}_student_upgrade`;
    await admin.query(`CREATE SCHEMA "${name}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
    });
    try {
      await runMigrations(fresh, getMigrationDirectory());
      const source = {
        MOCK_DATA: "true",
        AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
      };
      await seedAms161(fresh, source);
      const fallbackAuth = new AuthService(
        fresh,
        loadEnvironment({
          AUTH_TOKEN_SECRET:
            "a-secret-that-is-longer-than-thirty-two-characters",
        }),
        { send: async () => {} },
      );
      await expect(
        fallbackAuth.login(studentEmail, password),
      ).rejects.toMatchObject({ status: 401 });
      await fresh.query(
        "DELETE FROM course_memberships WHERE user_id=(SELECT id FROM users WHERE email=$1)",
        [studentEmail],
      );
      await fresh.query("DELETE FROM users WHERE email=$1", [studentEmail]);
      const existing = (
        await fresh.query(
          "SELECT id,email,display_name,password_hash,version FROM users ORDER BY id",
        )
      ).rows;
      const content = (
        await fresh.query(
          "SELECT id,body_markdown,version,endorsed_at FROM answers ORDER BY id",
        )
      ).rows;
      await seedAms161(fresh, {
        ...source,
        AMS161_DEMO_STUDENT_PASSWORD: studentPassword,
      });
      const { session } = await fallbackAuth.login(
        studentEmail,
        studentPassword,
      );
      expect(session.user.displayName).toBe("Riley Nguyen");
      const courses = new CourseService(fresh);
      expect(
        (
          await courses.getMember(
            AMS161_DEMO.courseId,
            session.user.id,
            session.user.id,
          )
        ).role,
      ).toBe("student");
      expect(
        (
          await fresh.query(
            "SELECT id,email,display_name,password_hash,version FROM users WHERE email<>$1 ORDER BY id",
            [studentEmail],
          )
        ).rows,
      ).toEqual(existing);
      expect(
        (
          await fresh.query(
            "SELECT id,body_markdown,version,endorsed_at FROM answers ORDER BY id",
          )
        ).rows,
      ).toEqual(content);
    } finally {
      await fresh.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
  });

  it("leaves a deleting course untouched on repeat, including during deletion", async () => {
    const name = `${schema}_deleting`;
    await admin.query(`CREATE SCHEMA "${name}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
      max: 1,
    });
    const locker = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
    });
    const source = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
      AMS161_DEMO_STUDENT_PASSWORD: studentPassword,
    };
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await seedAms161(fresh, source);
      await fresh.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [AMS161_DEMO.courseId, AMS161_DEMO.studentId],
      );
      await fresh.query("DELETE FROM users WHERE id=$1", [
        AMS161_DEMO.studentId,
      ]);
      await fresh.query(
        "DELETE FROM question_creation_daily_counts WHERE course_id=$1",
        [AMS161_DEMO.courseId],
      );
      await fresh.query(
        "DELETE FROM answer_contribution_events WHERE course_id=$1",
        [AMS161_DEMO.courseId],
      );
      const legacyBody =
        "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?";
      const legacy = (
        await fresh.query(
          "UPDATE posts SET body_markdown=$1 WHERE title='How do I parametrize an arc length problem?' RETURNING id,body_markdown,version",
          [legacyBody],
        )
      ).rows[0];
      await fresh.query("UPDATE courses SET status='deleting' WHERE id=$1", [
        AMS161_DEMO.courseId,
      ]);

      expect(await seedAms161(fresh, source)).toBe("already-seeded");
      expect(
        (
          await fresh.query(
            "SELECT id,body_markdown,version FROM posts WHERE id=$1",
            [legacy.id],
          )
        ).rows[0],
      ).toEqual(legacy);

      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM users WHERE id=$1",
            [AMS161_DEMO.studentId],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM course_memberships WHERE user_id=$1",
            [AMS161_DEMO.studentId],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM question_creation_daily_counts",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM answer_contribution_events",
          )
        ).rows[0].count,
      ).toBe(0);

      await fresh.query("UPDATE courses SET status='active' WHERE id=$1", [
        AMS161_DEMO.courseId,
      ]);
      const seedPid = (await fresh.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const client = await locker.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE courses SET status='deleting' WHERE id=$1", [
          AMS161_DEMO.courseId,
        ]);
        const pending = seedAms161(fresh, source);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting =
            (
              await admin.query(
                "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
                [seedPid],
              )
            ).rows[0]?.waiting === true;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await client.query("COMMIT");
        expect(await pending).toBe("already-seeded");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM users WHERE id=$1",
            [AMS161_DEMO.studentId],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM course_memberships WHERE user_id=$1",
            [AMS161_DEMO.studentId],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM question_creation_daily_counts",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await fresh.query(
            "SELECT count(*)::int AS count FROM answer_contribution_events",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await fresh.end();
      await locker.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
  });

  it("lets a runtime post write take its shared course lock during repeat repair", async () => {
    const name = `${schema}_runtime_lock`;
    await admin.query(`CREATE SCHEMA "${name}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
      max: 1,
    });
    const runtime = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
    });
    const source = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    };
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await seedAms161(fresh, source);
      const legacy = (
        await fresh.query<{ id: string }>(
          "UPDATE posts SET body_markdown=$1 WHERE title=$2 RETURNING id",
          [
            "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?",
            "How do I parametrize an arc length problem?",
          ],
        )
      ).rows[0]!;
      const seedPid = (await fresh.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const client = await runtime.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='750ms'");
        await client.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE", [
          legacy.id,
        ]);
        pending = seedAms161(fresh, source);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting =
            (
              await admin.query(
                "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
                [seedPid],
              )
            ).rows[0]?.waiting === true;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await client.query("SELECT id FROM courses WHERE id=$1 FOR SHARE", [
          AMS161_DEMO.courseId,
        ]);
        await client.query("COMMIT");
        expect(await pending).toBe("already-seeded");
      } finally {
        await client.query("ROLLBACK");
        client.release();
        if (pending) await pending;
      }
      expect(
        (
          await fresh.query("SELECT body_markdown FROM posts WHERE id=$1", [
            legacy.id,
          ])
        ).rows[0].body_markdown,
      ).toContain("$y = x^{3/2}$");
    } finally {
      await fresh.end();
      await runtime.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
  });

  it("lets an answer write lock its parent post during repeat math repair", async () => {
    const name = `${schema}_answer_lock`;
    await admin.query(`CREATE SCHEMA "${name}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
      max: 1,
    });
    const runtime = new Pool({
      connectionString: url,
      options: `--search_path="${name}"`,
    });
    const source = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    };
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await seedAms161(fresh, source);
      const post = (
        await fresh.query<{ id: string }>(
          "UPDATE posts SET body_markdown=$1 WHERE title=$2 RETURNING id",
          [
            "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?",
            "How do I parametrize an arc length problem?",
          ],
        )
      ).rows[0]!;
      const answer = (
        await fresh.query<{ id: string }>(
          "UPDATE answers SET body_markdown=$1 WHERE post_id=$2 AND kind='student' RETURNING id",
          [
            "Think of a tiny piece of the curve as the hypotenuse of a right triangle with legs dx and dy. Its length is sqrt(dx^2 + dy^2) = sqrt(1 + (dy/dx)^2) dx.",
            post.id,
          ],
        )
      ).rows[0]!;
      const seedPid = (await fresh.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const client = await runtime.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='750ms'");
        await client.query("SELECT id FROM answers WHERE id=$1 FOR UPDATE", [
          answer.id,
        ]);
        pending = seedAms161(fresh, source);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting =
            (
              await admin.query(
                "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
                [seedPid],
              )
            ).rows[0]?.waiting === true;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await client.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE", [
          post.id,
        ]);
        await client.query("SELECT id FROM courses WHERE id=$1 FOR SHARE", [
          AMS161_DEMO.courseId,
        ]);
        await client.query("COMMIT");
        expect(await pending).toBe("already-seeded");
      } finally {
        await client.query("ROLLBACK");
        client.release();
        if (pending) await pending;
      }
      const repaired = await fresh.query(
        "SELECT p.body_markdown AS post_body,a.body_markdown AS answer_body FROM posts p JOIN answers a ON a.post_id=p.id WHERE p.id=$1 AND a.id=$2",
        [post.id, answer.id],
      );
      expect(repaired.rows[0].post_body).toContain("$y = x^{3/2}$");
      expect(repaired.rows[0].answer_body).toContain("$\\sqrt{dx^2 + dy^2}");
    } finally {
      await fresh.end();
      await runtime.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
  });

  it("rejects reserved student identity or role collisions without overwriting them", async () => {
    const id = (
      await pool.query("SELECT id FROM users WHERE email=$1", [studentEmail])
    ).rows[0].id;
    const source = {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
      AMS161_DEMO_STUDENT_PASSWORD: studentPassword,
    };
    for (const [change, restore] of [
      [
        "UPDATE users SET email='someone.else@ams161.mock.chalktalk.invalid' WHERE id=$1",
        "UPDATE users SET email='riley.nguyen@ams161.mock.chalktalk.invalid' WHERE id=$1",
      ],
      [
        "UPDATE users SET deleted_at=now() WHERE id=$1",
        "UPDATE users SET deleted_at=NULL WHERE id=$1",
      ],
      [
        "UPDATE course_memberships SET role='ta' WHERE user_id=$1",
        "UPDATE course_memberships SET role='student' WHERE user_id=$1",
      ],
    ]) {
      await pool.query(change, [id]);
      const before = (
        await pool.query(
          "SELECT id,email,password_hash,display_name,version,deleted_at FROM users WHERE id=$1",
          [id],
        )
      ).rows;
      try {
        await expect(seedAms161(pool, source)).rejects.toThrow(/collid/);
        expect(
          (
            await pool.query(
              "SELECT id,email,password_hash,display_name,version,deleted_at FROM users WHERE id=$1",
              [id],
            )
          ).rows,
        ).toEqual(before);
      } finally {
        await pool.query(restore, [id]);
      }
    }
  });

  it("serializes concurrent first-time starts into one complete fixture", async () => {
    const concurrentSchema = `${schema}_concurrent`;
    await admin.query(`CREATE SCHEMA "${concurrentSchema}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${concurrentSchema}"`,
    });
    try {
      await runMigrations(fresh, getMigrationDirectory());
      const source = {
        MOCK_DATA: "true",
        AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
      };
      const outcomes = await Promise.all([
        seedAms161(fresh, source),
        seedAms161(fresh, source),
      ]);
      expect(outcomes.sort()).toEqual(["already-seeded", "created"]);
      const count = await fresh.query(
        "SELECT count(*)::int AS count FROM posts",
      );
      expect(count.rows[0].count).toBe(AMS161_FIXTURE.posts);
    } finally {
      await fresh.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${concurrentSchema}" CASCADE`);
    }
  });

  it("recognizes the legacy local organization marker without writing", async () => {
    const legacySchema = `${schema}_legacy`;
    await admin.query(`CREATE SCHEMA "${legacySchema}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${legacySchema}"`,
    });
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await fresh.query(
        "INSERT INTO organizations (id,domain,name) VALUES ($1,$2,'AMS161 Prototype')",
        [
          "a1610000-0000-7000-8000-000000000001",
          AMS161_DEMO.organizationDomain,
        ],
      );
      await expect(
        seedAms161(fresh, {
          MOCK_DATA: "true",
          AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
        }),
      ).resolves.toBe("already-seeded");
      const counts = await fresh.query(
        "SELECT (SELECT count(*)::int FROM organizations) AS organizations, (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM courses) AS courses",
      );
      expect(counts.rows[0]).toEqual({
        organizations: 1,
        users: 0,
        courses: 0,
      });
    } finally {
      await fresh.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`);
    }
  });

  it("fails an identifier collision without writing a partial fixture", async () => {
    const collisionSchema = `${schema}_collision`;
    await admin.query(`CREATE SCHEMA "${collisionSchema}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${collisionSchema}"`,
    });
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await fresh.query(
        "INSERT INTO organizations (id,domain,name) VALUES ($1,'existing.example','Existing')",
        [AMS161_DEMO.organizationId],
      );
      await expect(
        seedAms161(fresh, {
          MOCK_DATA: "true",
          AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
        }),
      ).rejects.toThrow(/collides/);
      const count = await fresh.query(
        "SELECT count(*)::int AS count FROM users",
      );
      expect(count.rows[0].count).toBe(0);
    } finally {
      await fresh.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${collisionSchema}" CASCADE`);
    }
  });

  it("rolls back all fixture writes when a later insert fails", async () => {
    const failureSchema = `${schema}_failure`;
    await admin.query(`CREATE SCHEMA "${failureSchema}"`);
    const fresh = new Pool({
      connectionString: url,
      options: `--search_path="${failureSchema}"`,
    });
    try {
      await runMigrations(fresh, getMigrationDirectory());
      await fresh.query(
        `CREATE FUNCTION fail_mock_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced post insert failure'; END $$`,
      );
      await fresh.query(
        "CREATE TRIGGER fail_mock_post BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION fail_mock_post()",
      );
      await expect(
        seedAms161(fresh, {
          MOCK_DATA: "true",
          AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
        }),
      ).rejects.toThrow(/forced post insert failure/);
      const counts = await fresh.query(
        "SELECT (SELECT count(*)::int FROM organizations) AS organizations, (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM courses) AS courses",
      );
      expect(counts.rows[0]).toEqual({
        organizations: 0,
        users: 0,
        courses: 0,
      });
    } finally {
      await fresh.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${failureSchema}" CASCADE`);
    }
  });

  it("reformats only exact original fixture bodies once while retaining endorsements and metadata", async () => {
    const title = "How do I parametrize an arc length problem?";
    const oldQuestion =
      "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?";
    const oldAnswer =
      "Pick u = ln(x) because its derivative 1/x is simpler, and dv = x^2 dx because it is easy to integrate.";
    const question = (
      await pool.query(
        "UPDATE posts SET body_markdown=$1 WHERE title=$2 RETURNING id,version::int AS version",
        [oldQuestion, title],
      )
    ).rows[0];
    const answer = (
      await pool.query(
        `UPDATE answers SET body_markdown=$1 WHERE post_id=(SELECT id FROM posts WHERE title='When should I use integration by parts?') AND kind='student' RETURNING id,version::int AS version,endorsed_at`,
        [oldAnswer],
      )
    ).rows[0];
    expect(answer.endorsed_at).not.toBeNull();
    const custom = (
      await pool.query(
        "UPDATE posts SET body_markdown='My custom calculus question' WHERE title='How do I set up a disk or washer volume?' RETURNING id,version::int AS version",
      )
    ).rows[0];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [
        "posts",
        "answers",
        "answer_contributors",
        "answer_endorsement_events",
        "question_creation_daily_counts",
        "answer_contribution_events",
        "courses",
      ]) {
        const strip =
          table === "posts" || table === "answers"
            ? " - 'body_markdown' - 'version' - 'search_vector'"
            : "";
        result[table] = (
          await pool.query(
            `SELECT COALESCE(jsonb_agg(value ORDER BY value::text),'[]') AS rows FROM (SELECT to_jsonb(t)${strip} AS value FROM ${table} t) s`,
          )
        ).rows[0].rows;
      }
      return result;
    };
    const editedAnswer = (
      await pool.query(
        "UPDATE answers SET body_markdown='User-written arc length answer' WHERE post_id=$1 AND kind='staff' RETURNING id,body_markdown,version",
        [question.id],
      )
    ).rows[0];
    const before = await snapshot();
    await seedAms161(pool, {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    });
    const repairedQuestion = (
      await pool.query(
        "SELECT body_markdown,version::int AS version FROM posts WHERE id=$1",
        [question.id],
      )
    ).rows[0];
    expect(repairedQuestion).toEqual({
      body_markdown:
        "For $y = x^{3/2}$ from $x = 0$ to $x = 4$, where does the square root in the arc length formula come from?",
      version: question.version + 1,
    });
    const repairedAnswer = (
      await pool.query(
        "SELECT body_markdown,version::int AS version FROM answers WHERE id=$1",
        [answer.id],
      )
    ).rows[0];
    expect(repairedAnswer).toEqual({
      body_markdown:
        "Pick $u = \\ln(x)$ because its derivative $1/x$ is simpler, and $dv = x^2\\,dx$ because it is easy to integrate.",
      version: answer.version + 1,
    });
    expect(
      (
        await pool.query(
          "SELECT body_markdown,version::int AS version FROM posts WHERE id=$1",
          [custom.id],
        )
      ).rows[0],
    ).toEqual({
      body_markdown: "My custom calculus question",
      version: custom.version,
    });
    expect(
      (
        await pool.query(
          "SELECT id,body_markdown,version FROM answers WHERE id=$1",
          [editedAnswer.id],
        )
      ).rows[0],
    ).toEqual(editedAnswer);
    expect(await snapshot()).toEqual(before);
    await seedAms161(pool, {
      MOCK_DATA: "true",
      AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
    });
    expect(
      (
        await pool.query(
          "SELECT body_markdown,version::int AS version FROM posts WHERE id=$1",
          [question.id],
        )
      ).rows[0],
    ).toEqual(repairedQuestion);
    expect(
      (
        await pool.query(
          "SELECT body_markdown,version::int AS version FROM answers WHERE id=$1",
          [answer.id],
        )
      ).rows[0],
    ).toEqual(repairedAnswer);
    expect(
      (
        await pool.query(
          "SELECT id,body_markdown,version FROM answers WHERE id=$1",
          [editedAnswer.id],
        )
      ).rows[0],
    ).toEqual(editedAnswer);
    expect(await snapshot()).toEqual(before);
  });
});
