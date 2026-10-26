import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { PostService } from "../posts/service.js";
import { convertExport } from "./convert.js";
import { piazzaFixture } from "./fixture.js";
import { importPiazzaCourse, piazzaEmail } from "./importer.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `piazza_import_${process.pid}_${Date.now()}`;
const ownerEmail = "owner@piazza-import.test";
const demoPassword = "piazza demo password 123";
let admin: Pool;
let pool: Pool;

integration("Piazza import", () => {
  let ownerId: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    const org = await pool.query<{ id: string }>(
      "INSERT INTO organizations (id,domain,name) VALUES (gen_random_uuid(),'piazza-import.test','Test') RETURNING id",
    );
    const owner = await pool.query<{ id: string }>(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES (gen_random_uuid(),$1,$2,'Owner','x') RETURNING id",
      [org.rows[0]!.id, ownerEmail],
    );
    ownerId = owner.rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("rejects an owner without a ChalkTalk account and writes nothing", async () => {
    await expect(
      importPiazzaCourse(pool, convertExport(piazzaFixture()), {
        ownerEmail: "nobody@x.test",
      }),
    ).rejects.toThrow(/No ChalkTalk account/);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM courses")).rows[0].n,
    ).toBe(0);
  });

  it("creates the course, members, posts, answers and followups", async () => {
    const summary = await importPiazzaCourse(
      pool,
      convertExport(piazzaFixture()),
      {
        ownerEmail,
        demoPassword,
      },
    );
    expect(summary).toMatchObject({
      courseName: "CSE 416 Software Engineering",
      posts: { created: 4, updated: 0, skipped: 0 },
      answers: { created: 2, updated: 0, skipped: 0 },
      followups: { created: 3, updated: 0, skipped: 0 },
    });
    expect(summary.joinCode).toMatch(/^[A-Z0-9]{8}$/);

    const members = await pool.query(
      "SELECT display_name,role FROM course_memberships JOIN users ON users.id=user_id WHERE course_id=$1 ORDER BY display_name",
      [summary.courseId],
    );
    // The fetching account maps to the owner; unknown authors still get an account.
    expect(members.rows).toEqual([
      { display_name: "Anonymous Piazza user", role: "student" },
      { display_name: "Owner", role: "instructor" },
      { display_name: "Pat Professor", role: "instructor" },
      { display_name: "Piazza user", role: "student" },
      { display_name: "Sam Student", role: "student" },
      { display_name: "Tia Assistant", role: "ta" },
    ]);

    const posts = new PostService(pool);
    const feed = await posts.list(summary.courseId, ownerId, {
      limit: 30,
      sort: "recent_activity",
    });
    expect(feed.data.map((post) => post.title).sort()).toEqual([
      "How does $$O(n^2)$$ arise?",
      "Pick a day",
      "Private grade question",
      "Welcome & syllabus",
    ]);
    const tags = await pool.query(
      "SELECT t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE t.course_id=$1 ORDER BY t.name",
      [summary.courseId],
    );
    expect(tags.rows.map((row) => row.name)).toEqual([
      "exam",
      "hw1",
      "logistics",
    ]);

    const question = await pool.query(
      "SELECT p.anonymous,p.created_at,p.last_activity_at,u.display_name FROM posts p JOIN users u ON u.id=p.author_user_id WHERE p.course_id=$1 AND p.type='question' AND NOT p.private",
      [summary.courseId],
    );
    expect(question.rows[0]).toMatchObject({
      anonymous: true,
      display_name: "Anonymous Piazza user",
      created_at: new Date("2026-09-02T10:00:00Z"),
      last_activity_at: new Date("2026-09-04T09:00:00Z"),
    });
    const privatePost = await pool.query(
      "SELECT private,author_user_id FROM posts WHERE course_id=$1 AND title='Private grade question'",
      [summary.courseId],
    );
    expect(privatePost.rows[0]).toEqual({
      private: true,
      author_user_id: ownerId,
    });

    const answers = await pool.query(
      `SELECT a.kind,a.edit_role_floor,creator.display_name AS creator,endorser.display_name AS endorser,
         (SELECT count(*)::int FROM answer_contributors c WHERE c.answer_id=a.id) AS contributors,
         (SELECT count(*)::int FROM answer_upvotes v WHERE v.answer_id=a.id) AS upvotes
       FROM answers a JOIN users creator ON creator.id=a.created_by_user_id
       LEFT JOIN users endorser ON endorser.id=a.endorsed_by_user_id
       WHERE a.course_id=$1 ORDER BY a.kind`,
      [summary.courseId],
    );
    expect(answers.rows).toEqual([
      {
        kind: "staff",
        edit_role_floor: "ta",
        creator: "Tia Assistant",
        endorser: null,
        contributors: 2,
        upvotes: 0,
      },
      {
        kind: "student",
        edit_role_floor: "student",
        creator: "Sam Student",
        endorser: "Pat Professor",
        contributors: 1,
        upvotes: 1,
      },
    ]);
    const followups = await pool.query(
      `SELECT f.body_markdown,f.anonymous,f.parent_followup_id IS NOT NULL AS reply,
         f.resolved_at IS NOT NULL AS resolved,u.display_name AS author
       FROM followups f JOIN users u ON u.id=f.author_user_id WHERE f.course_id=$1 ORDER BY f.created_at`,
      [summary.courseId],
    );
    expect(followups.rows).toEqual([
      {
        body_markdown: "What about three loops?",
        anonymous: false,
        reply: false,
        resolved: true,
        author: "Owner",
      },
      {
        body_markdown: "Cubic.",
        anonymous: false,
        reply: true,
        resolved: false,
        author: "Tia Assistant",
      },
      {
        body_markdown: "Anonymous worry",
        anonymous: true,
        reply: false,
        resolved: false,
        author: "Anonymous Piazza user",
      },
    ]);
    const stats = await pool.query(
      "SELECT (SELECT sum(question_count)::int FROM question_creation_daily_counts WHERE course_id=$1) AS questions, (SELECT count(*)::int FROM answer_contribution_events WHERE course_id=$1) AS contributions",
      [summary.courseId],
    );
    expect(stats.rows[0]).toEqual({ questions: 2, contributions: 3 });
  });

  it("lets imported people log in only with the demo password", async () => {
    const auth = new AuthService(
      pool,
      loadEnvironment({
        AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      }),
      { send: async () => {} },
    );
    const login = await auth.login(
      piazzaEmail("Sam Student", "stu1"),
      demoPassword,
    );
    expect(login.session.user.displayName).toBe("Sam Student");
    await expect(
      auth.login(piazzaEmail("Sam Student", "stu1"), "wrong password 123"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("re-imports without duplicating, adds new content, refreshes edits and keeps ChalkTalk deletions", async () => {
    const data = piazzaFixture();
    const welcome = data.posts.find((post) => post.id === "p1")!;
    welcome.history.unshift({
      ...welcome.history[0]!,
      content: "<p>Updated syllabus.</p>",
      created: "2026-09-10T00:00:00Z",
    });
    data.posts
      .find((post) => post.id === "p2")!
      .children!.push({
        id: "f3",
        type: "followup",
        uid: "stu1",
        anon: "no",
        subject: "Late followup",
        created: "2026-09-11T00:00:00Z",
        no_answer: 1,
      });
    data.posts.push({
      id: "p6",
      type: "note",
      status: "active",
      created: "2026-09-12T00:00:00Z",
      history: [
        {
          anon: "no",
          uid: "ta1",
          subject: "New note",
          content: "Hello",
          created: "2026-09-12T00:00:00Z",
        },
      ],
    });
    const before = await pool.query<{ id: string; course_id: string }>(
      "SELECT id,course_id FROM posts WHERE title='Pick a day'",
    );
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [before.rows[0]!.id],
    );

    const summary = await importPiazzaCourse(pool, convertExport(data), {
      ownerEmail,
    });
    expect(summary.courseId).toBe(before.rows[0]!.course_id);
    expect(summary).toMatchObject({
      posts: { created: 1, updated: 1, skipped: 1 },
      answers: { created: 0, updated: 0, skipped: 0 },
      followups: { created: 1, updated: 0, skipped: 0 },
    });
    const counts = await pool.query(
      "SELECT (SELECT count(*)::int FROM posts WHERE course_id=$1 AND deleted_at IS NULL) AS posts, (SELECT count(*)::int FROM courses) AS courses, (SELECT count(*)::int FROM course_memberships WHERE course_id=$1) AS members",
      [summary.courseId],
    );
    expect(counts.rows[0]).toEqual({ posts: 4, courses: 1, members: 6 });
    const updated = await pool.query(
      "SELECT body_markdown,version FROM posts WHERE title='Welcome & syllabus'",
    );
    expect(updated.rows[0]).toEqual({
      body_markdown: "Updated syllabus.",
      version: "2",
    });
    // Without a demo password, the earlier demo password keeps working.
    const auth = new AuthService(
      pool,
      loadEnvironment({
        AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      }),
      { send: async () => {} },
    );
    await expect(
      auth.login(piazzaEmail("Tia Assistant", "ta1"), demoPassword),
    ).resolves.toBeTruthy();
  });
});
