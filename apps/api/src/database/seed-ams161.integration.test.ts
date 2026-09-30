import { Pool } from "pg";
import { version as uuidVersion } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "./migrate.js";
import { seedAms161, AMS161_DEMO, AMS161_FIXTURE } from "./seed-ams161.js";
import { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { PostService } from "../posts/service.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `ams161_seed_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const password = "local demo password 123";

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

  it("creates course members and a varied discussion with no merged posts", async () => {
    expect(
      await seedAms161(pool, {
        MOCK_DATA: "true",
        AMS161_DEMO_INSTRUCTOR_PASSWORD: password,
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
      "SELECT a.kind, count(*)::int AS count, count(a.endorsed_at)::int AS endorsed, bool_and(a.created_at>=p.created_at) AS after_post, bool_and(c.answer_id IS NOT NULL) AS contributed FROM answers a JOIN posts p ON p.id=a.post_id JOIN answer_collaboration_documents c ON c.answer_id=a.id WHERE a.course_id=$1 GROUP BY a.kind ORDER BY a.kind",
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
});
