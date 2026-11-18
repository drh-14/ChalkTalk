import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEmailSender } from "../auth/email.js";
import { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { CourseService } from "../courses/service.js";
import { PostService } from "../posts/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { NotificationService } from "../notifications/service.js";
import { ThreadService } from "../threads/service.js";
import { ThreadWatchService } from "../threads/watch.js";
import { CourseResourceService } from "../course-resources/service.js";
import { createApp } from "../http/app.js";
import {
  fixtureIdentity,
  inventoryFixture,
  provisionFixture,
  teardownFixture,
  type FixtureManifest,
} from "./load-test-fixture.js";

const url =
  process.env.RUN_K6_FIXTURE_INTEGRATION === "1"
    ? process.env.TEST_DATABASE_URL
    : undefined;
const integration = url ? describe : describe.skip;

integration("isolated PostgreSQL fixture lifecycle", () => {
  it("serves Ramp Thread and resource journeys through the real API, then tears down all dependents", async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55432")
      throw new Error(
        "Fixture test must target isolated Docker PostgreSQL on port 55432",
      );
    const pool = new Pool({ connectionString: url });
    const runId = `load-20261117-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const manifest = await provisionFixture(
        pool,
        runId,
        "a".repeat(40),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
        async () => {},
        "ramp",
      );
      const environment = loadEnvironment({
        AUTH_TOKEN_SECRET:
          "isolated-load-test-secret-longer-than-32-characters",
        FRONTEND_ORIGINS: "https://joinchalktalk.com",
        FRONTEND_BASE_URL: "https://joinchalktalk.com",
        DATABASE_URL: url!,
      });
      const authService = new AuthService(
        pool,
        environment,
        createEmailSender(environment),
      );
      const application = createApp({
        environment,
        authService,
        threadService: new ThreadService(pool),
        threadWatchService: new ThreadWatchService(pool),
        courseResourceService: new CourseResourceService(pool),
        notificationService: new NotificationService(pool),
      });
      const sessions = [];
      for (const user of [manifest.users[0]!, manifest.users[3]!]) {
        const login = await request(application)
          .post("/api/v1/sessions")
          .set("Origin", environment.frontendBaseUrl)
          .send({ email: user.email, password: user.password })
          .expect(201);
        sessions.push({
          cookie: login.headers["set-cookie"][0].split(";")[0],
          csrf: login.body.data.csrfToken as string,
        });
      }
      const staff = sessions[0]!;
      const student = sessions[1]!;
      const course = manifest.courses![0]!;
      const root = `/api/v1/courses/${course.id}`;
      const thread = `${root}/threads/${course.boardId}`;
      const write = (
        session: typeof staff,
        method: "post" | "put",
        path: string,
      ) => {
        const agent = request(application);
        return agent[method](path)
          .set("Cookie", session.cookie)
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", session.csrf);
      };
      const read = (session: typeof staff, path: string) =>
        request(application).get(path).set("Cookie", session.cookie);
      await read(student, `${root}/resources`).expect(200);
      await read(student, `${root}/resources/search?q=guide&limit=10`).expect(
        200,
      );
      await read(student, `${root}/threads`).expect(200);
      const conversation = await write(staff, "post", `${thread}/conversations`)
        .send({ bodyMarkdown: "Synthetic conversation" })
        .expect(201);
      const conversationId = conversation.body.data.id as string;
      const path = `${thread}/conversations/${conversationId}`;
      await read(student, `${thread}/conversations`).expect(200);
      await read(student, path).expect(200);
      await write(student, "put", `${path}/watch`)
        .send({ noticesEnabled: true })
        .expect(200);
      const reply = await write(staff, "post", `${path}/messages`)
        .send({ bodyMarkdown: "Synthetic reply" })
        .expect(201);
      await read(student, `${path}/messages`).expect(200);
      await write(student, "post", `${path}/read`)
        .send({ messageIds: [reply.body.data.id] })
        .expect(204);
      await read(student, `${root}/threads/changes?limit=20`).expect(200);
      await read(student, `${root}/threads/unread-count`).expect(200);
      await read(student, "/api/v1/users/me/notifications").expect(200);
      const client = await pool.connect();
      try {
        expect((await inventoryFixture(client, manifest)).violations).toEqual(
          [],
        );
      } finally {
        client.release();
      }
      const counts = await teardownFixture(pool, manifest);
      expect(counts.thread_conversations).toBe(1);
      expect(counts.thread_messages).toBe(2);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM courses WHERE organization_id=$1",
            [manifest.organizationId],
          )
        ).rows[0]!.n,
      ).toBe(0);
    } finally {
      await pool.end();
    }
  }, 120_000);
  it("provisions three Ramp cohorts and reviews Thread/resource dependents before zero-residue cleanup", async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55432")
      throw new Error(
        "Fixture test must target isolated Docker PostgreSQL on port 55432",
      );
    const pool = new Pool({ connectionString: url });
    const runId = `load-20261117-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const manifest = await provisionFixture(
        pool,
        runId,
        "a".repeat(40),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
        async () => {},
        "ramp",
      );
      expect(manifest.courses).toHaveLength(3);
      expect(manifest.users).toHaveLength(30);
      const course = manifest.courses![0]!;
      const conversationId = randomUUID();
      const messageId = randomUUID();
      const changeEntityId = randomUUID();
      await pool.query(
        "INSERT INTO thread_conversations(id,course_id,board_id,created_by_user_id,next_message_ordinal) VALUES($1,$2,$3,$4,2)",
        [conversationId, course.id, course.boardId, manifest.users[0]!.id],
      );
      await pool.query(
        "INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown) VALUES($1,$2,$3,$4,1,$5,'instructor','synthetic')",
        [
          messageId,
          course.id,
          course.boardId,
          conversationId,
          manifest.users[0]!.id,
        ],
      );
      await pool.query(
        "INSERT INTO thread_watches(course_id,conversation_id,user_id) VALUES($1,$2,$3)",
        [course.id, conversationId, manifest.users[3]!.id],
      );
      await pool.query(
        "INSERT INTO thread_message_reads(course_id,message_id,user_id) VALUES($1,$2,$3)",
        [course.id, messageId, manifest.users[3]!.id],
      );
      await pool.query(
        "INSERT INTO thread_notifications(id,course_id,conversation_id,message_id,recipient_user_id,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          course.id,
          conversationId,
          messageId,
          manifest.users[3]!.id,
          manifest.users[0]!.id,
        ],
      );
      await pool.query(
        "INSERT INTO thread_course_counters(course_id,sequence) VALUES($1,1)",
        [course.id],
      );
      await pool.query(
        "INSERT INTO thread_changes(course_id,sequence,board_id,kind,entity_id) VALUES($1,1,$2,'message_created',$3)",
        [course.id, course.boardId, changeEntityId],
      );
      const inventory = async () => {
        const client = await pool.connect();
        try {
          return await inventoryFixture(client, manifest);
        } finally {
          client.release();
        }
      };
      expect((await inventory()).violations).toContain(
        "thread_changes.entity_id: unknown fixture entity",
      );
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /unknown fixture entity/,
      );
      await pool.query(
        "UPDATE thread_changes SET entity_id=$1 WHERE course_id=$2 AND sequence=1",
        [messageId, course.id],
      );
      expect((await inventory()).violations).toEqual([]);
      const deleted = await teardownFixture(pool, manifest);
      expect(deleted.courses).toBe(3);
      expect(deleted.users).toBe(30);
      expect(deleted.thread_notifications).toBe(1);
      expect((await inventory()).counts.courses).toBe(0);
      expect((await inventory()).counts.thread_changes ?? 0).toBe(0);
    } finally {
      await pool.end();
    }
  }, 120_000);
  it("enforces semantic job, catch-up, and indexable-post caps before transactional cleanup", async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55432")
      throw new Error(
        "Fixture test must target isolated Docker PostgreSQL on port 55432",
      );
    const pool = new Pool({ connectionString: url });
    const runId = `load-20261117-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const manifest = await provisionFixture(
        pool,
        runId,
        "a".repeat(40),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
        async () => {},
      );
      const revision = "c".repeat(64);
      const generations = Array.from({ length: 65 }, (_, i) =>
        (i + 1).toString(16).padStart(64, "0"),
      );
      const jobIds = generations.map(() => randomUUID());
      for (let i = 0; i < 64; i++) {
        await pool.query(
          "INSERT INTO jobs(id,kind,payload,deduplication_key,status) VALUES($1,'index_post',$2,$3,'succeeded')",
          [
            jobIds[i],
            {
              postId: manifest.questionId,
              generation: generations[i],
              revision,
            },
            `${manifest.questionId}:${generations[i]}:${revision}`,
          ],
        );
      }
      const inventory = async () => {
        const client = await pool.connect();
        try {
          return await inventoryFixture(client, manifest);
        } finally {
          client.release();
        }
      };
      expect((await inventory()).counts.jobs).toBe(64);
      expect((await inventory()).violations).toEqual([]);
      await pool.query(
        "INSERT INTO jobs(id,kind,payload,deduplication_key,status) VALUES($1,'index_post',$2,$3,'succeeded')",
        [
          jobIds[64],
          {
            postId: manifest.questionId,
            generation: generations[64],
            revision,
          },
          `${manifest.questionId}:${generations[64]}:${revision}`,
        ],
      );
      expect((await inventory()).counts.jobs).toBe(65);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /semantic job cap exceeded/,
      );
      expect(
        (
          await pool.query("SELECT 1 FROM jobs WHERE id=ANY($1::uuid[])", [
            jobIds,
          ])
        ).rowCount,
      ).toBe(65);
      await pool.query("DELETE FROM jobs WHERE id=$1", [jobIds[64]]);

      for (let i = 0; i < 64; i++)
        await pool.query(
          "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2)",
          [manifest.questionId, generations[i]],
        );
      expect((await inventory()).counts.semantic_post_catchup).toBe(64);
      expect((await inventory()).violations).toEqual([]);
      await pool.query(
        "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2)",
        [manifest.questionId, generations[64]],
      );
      expect((await inventory()).counts.semantic_post_catchup).toBe(65);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /catch-up cap exceeded/,
      );
      expect(
        (
          await pool.query(
            "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
            [manifest.questionId],
          )
        ).rowCount,
      ).toBe(65);
      await pool.query(
        "DELETE FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
        [manifest.questionId, generations[64]],
      );

      const extraPosts = Array.from({ length: 7 }, () => randomUUID());
      for (let i = 0; i < 6; i++)
        await pool.query(
          "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,$4,$5,'Synthetic')",
          [
            extraPosts[i],
            manifest.courseId,
            manifest.users[0]!.id,
            i % 2 ? "note" : "question",
            `Cap post ${i}`,
          ],
        );
      expect((await inventory()).counts.indexable_posts).toBe(7);
      expect((await inventory()).violations).toEqual([]);
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'note','Cap excess','Synthetic')",
        [extraPosts[6], manifest.courseId, manifest.users[0]!.id],
      );
      expect((await inventory()).counts.indexable_posts).toBe(8);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /indexable post cap exceeded/,
      );
      expect(
        (
          await pool.query("SELECT 1 FROM jobs WHERE id=ANY($1::uuid[])", [
            jobIds,
          ])
        ).rowCount,
      ).toBe(64);
      await pool.query("DELETE FROM posts WHERE id=$1", [extraPosts[6]]);

      await pool.query(`CREATE FUNCTION k6_fixture_cap_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'cap cleanup rollback'; END $$`);
      await pool.query(`CREATE TRIGGER k6_fixture_cap_delete_guard BEFORE DELETE ON courses
        FOR EACH ROW EXECUTE FUNCTION k6_fixture_cap_delete_guard()`);
      try {
        await expect(teardownFixture(pool, manifest)).rejects.toThrow(
          "cap cleanup rollback",
        );
        expect((await inventory()).counts.jobs).toBe(64);
        expect((await inventory()).counts.semantic_post_catchup).toBe(64);
        expect((await inventory()).counts.indexable_posts).toBe(7);
      } finally {
        await pool.query("DROP TRIGGER k6_fixture_cap_delete_guard ON courses");
        await pool.query("DROP FUNCTION k6_fixture_cap_delete_guard()");
      }
      const deleted = await teardownFixture(pool, manifest);
      expect(deleted.jobs).toBe(64);
      expect(deleted.semantic_post_catchup).toBe(64);
      expect(deleted.indexable_posts).toBe(7);
      expect(
        (
          await pool.query("SELECT 1 FROM jobs WHERE id=ANY($1::uuid[])", [
            jobIds,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
            [manifest.questionId],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("rolls back partial seed, refuses namespace reuse and foreign references, then removes only owned rows", async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55432")
      throw new Error(
        "Fixture test must target isolated Docker PostgreSQL on port 55432",
      );
    const pool = new Pool({ connectionString: url });
    const runId = `load-20261117-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const sha = "a".repeat(40);
    const { domain } = fixtureIdentity(runId);
    let manifest: FixtureManifest | undefined;
    const foreignOrg = randomUUID();
    const foreignUser = randomUUID();
    try {
      await expect(
        provisionFixture(
          pool,
          runId,
          sha,
          "abcdefghijklmnopqrst",
          "aws-0-us-east-1.pooler.supabase.com",
          async () => {
            throw new Error("manifest write failed");
          },
        ),
      ).rejects.toThrow("manifest write failed");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM organizations WHERE domain=$1",
            [domain],
          )
        ).rows[0].n,
      ).toBe(0);

      manifest = await provisionFixture(
        pool,
        runId,
        sha,
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
        async (data) => {
          manifest = data;
        },
      );
      expect(manifest.users).toHaveLength(20);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM course_memberships WHERE course_id=$1",
            [manifest.courseId],
          )
        ).rows[0].n,
      ).toBe(20);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM users WHERE organization_id=$1 AND notification_emails=false",
            [manifest.organizationId],
          )
        ).rows[0].n,
      ).toBe(20);
      await expect(
        provisionFixture(
          pool,
          runId,
          sha,
          "abcdefghijklmnopqrst",
          "aws-0-us-east-1.pooler.supabase.com",
          async () => {},
        ),
      ).rejects.toThrow("namespace already exists");

      await pool.query(
        "INSERT INTO organizations (id,domain,name) VALUES ($1,$2,'Foreign')",
        [foreignOrg, `${randomUUID()}.invalid`],
      );
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,'Foreign','hash')",
        [foreignUser, foreignOrg, `${randomUUID()}@foreign.invalid`],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
        [manifest.courseId, foreignUser],
      );
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /foreign reference/,
      );
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM organizations WHERE id=$1",
            [manifest.organizationId],
          )
        ).rows[0].n,
      ).toBe(1);
      await pool.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [manifest.courseId, foreignUser],
      );
      await pool.query("DELETE FROM users WHERE id=$1", [foreignUser]);
      await pool.query("DELETE FROM organizations WHERE id=$1", [foreignOrg]);

      const environment = loadEnvironment({
        AUTH_TOKEN_SECRET:
          "isolated-load-test-secret-longer-than-32-characters",
        FRONTEND_ORIGINS: "https://joinchalktalk.com",
        FRONTEND_BASE_URL: "https://joinchalktalk.com",
        DATABASE_URL: url!,
      });
      const application = createApp({
        environment,
        authService: new AuthService(
          pool,
          environment,
          createEmailSender(environment),
        ),
        courseService: new CourseService(pool),
        postService: new PostService(pool),
        answerService: new AnswerService(pool),
        followupService: new FollowupService(pool),
        notificationService: new NotificationService(pool),
      });
      const login = await request(application)
        .post("/api/v1/sessions")
        .set("Origin", "https://joinchalktalk.com")
        .send({
          email: manifest.users[0]!.email,
          password: manifest.users[0]!.password,
        })
        .expect(201);
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      const csrf = login.body.data.csrfToken as string;
      const mutate = (path: string) =>
        request(application)
          .post(path)
          .set("Cookie", cookie)
          .set("Origin", "https://joinchalktalk.com")
          .set("X-CSRF-Token", csrf);
      await request(application)
        .get("/api/v1/courses")
        .set("Cookie", cookie)
        .expect(200);
      await request(application)
        .get(`/api/v1/courses/${manifest.courseId}/posts`)
        .set("Cookie", cookie)
        .expect(200);
      await request(application)
        .get(`/api/v1/posts/${manifest.questionId}`)
        .set("Cookie", cookie)
        .expect(200);
      await request(application)
        .get("/api/v1/users/me/notifications")
        .set("Cookie", cookie)
        .expect(200);
      await request(application)
        .get("/api/v1/users/me/notifications/unread-count")
        .set("Cookie", cookie)
        .expect(200);
      const question = await mutate(
        `/api/v1/courses/${manifest.courseId}/posts`,
      )
        .send({
          type: "question",
          title: "Load test API question",
          bodyMarkdown: "Synthetic question",
        })
        .expect(201);
      await mutate(`/api/v1/courses/${manifest.courseId}/posts`)
        .send({
          type: "note",
          title: "Load test API note",
          bodyMarkdown: "Synthetic note",
        })
        .expect(201);
      await mutate(`/api/v1/posts/${question.body.data.id}/answers`)
        .send({ bodyMarkdown: "Synthetic answer" })
        .expect(201);
      await mutate(`/api/v1/posts/${question.body.data.id}/followups`)
        .send({ bodyMarkdown: "Synthetic followup" })
        .expect(201);
      const poll = await mutate(`/api/v1/courses/${manifest.courseId}/posts`)
        .send({
          type: "poll",
          title: "Load test API poll",
          bodyMarkdown: "Synthetic poll",
          options: [{ label: "Yes" }, { label: "No" }],
        })
        .expect(201);
      await request(application)
        .put(`/api/v1/posts/${poll.body.data.id}/vote`)
        .set("Cookie", cookie)
        .set("Origin", "https://joinchalktalk.com")
        .set("X-CSRF-Token", csrf)
        .send({ optionId: poll.body.data.options[0].id })
        .expect(200);

      const indexedPost = question.body.data.id as string;
      const generation = "b".repeat(64);
      const revision = "c".repeat(64);
      const indexedJob = randomUUID();
      await pool.query(
        "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2)",
        [indexedPost, generation],
      );
      await pool.query(
        "INSERT INTO jobs(id,kind,payload,deduplication_key,status) VALUES($1,'index_post',$2,$3,'queued')",
        [
          indexedJob,
          { postId: indexedPost, generation, revision },
          `${indexedPost}:${generation}:${revision}`,
        ],
      );
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /not quiescent/,
      );
      await pool.query("UPDATE jobs SET status='running' WHERE id=$1", [
        indexedJob,
      ]);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /not quiescent/,
      );
      await pool.query("UPDATE jobs SET status='dead' WHERE id=$1", [
        indexedJob,
      ]);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /not quiescent/,
      );
      await pool.query("UPDATE jobs SET status='succeeded' WHERE id=$1", [
        indexedJob,
      ]);
      const foreignJob = randomUUID();
      await pool.query(
        "INSERT INTO jobs(id,kind,payload,deduplication_key,status) VALUES($1,'other',$2,$3,'succeeded')",
        [foreignJob, { postId: indexedPost }, randomUUID()],
      );
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /ambiguous or foreign/,
      );
      await pool.query("DELETE FROM jobs WHERE id=$1", [foreignJob]);
      await pool.query("UPDATE jobs SET payload=$2 WHERE id=$1", [
        indexedJob,
        {
          postId: indexedPost,
          generation,
          revision,
          foreignPostId: randomUUID(),
        },
      ]);
      await expect(teardownFixture(pool, manifest)).rejects.toThrow(
        /ambiguous or foreign/,
      );
      await pool.query("UPDATE jobs SET payload=$2 WHERE id=$1", [
        indexedJob,
        { postId: indexedPost, generation, revision },
      ]);

      const client = await pool.connect();
      try {
        expect((await inventoryFixture(client, manifest)).violations).toEqual(
          [],
        );
        expect((await inventoryFixture(client, manifest)).counts.jobs).toBe(1);
        expect(
          (await inventoryFixture(client, manifest)).counts
            .semantic_post_catchup,
        ).toBe(1);
      } finally {
        client.release();
      }
      await pool.query(`CREATE FUNCTION k6_fixture_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated cleanup failure'; END $$`);
      await pool.query(`CREATE TRIGGER k6_fixture_delete_guard BEFORE DELETE ON courses
        FOR EACH ROW EXECUTE FUNCTION k6_fixture_delete_guard()`);
      try {
        await expect(teardownFixture(pool, manifest)).rejects.toThrow(
          "simulated cleanup failure",
        );
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM users WHERE organization_id=$1",
              [manifest.organizationId],
            )
          ).rows[0].n,
        ).toBe(20);
        expect(
          (await pool.query("SELECT 1 FROM jobs WHERE id=$1", [indexedJob]))
            .rowCount,
        ).toBe(1);
      } finally {
        await pool.query("DROP TRIGGER k6_fixture_delete_guard ON courses");
        await pool.query("DROP FUNCTION k6_fixture_delete_guard()");
      }
      await pool.query(
        "CREATE TABLE k6_unknown_ref (odd_name uuid REFERENCES users(id) ON DELETE CASCADE)",
      );
      try {
        await pool.query("INSERT INTO k6_unknown_ref (odd_name) VALUES ($1)", [
          manifest.users[0]!.id,
        ]);
        await expect(teardownFixture(pool, manifest)).rejects.toThrow(
          /unrecognized references/,
        );
        expect(
          (await pool.query("SELECT count(*)::int AS n FROM k6_unknown_ref"))
            .rows[0].n,
        ).toBe(1);
      } finally {
        await pool.query("DROP TABLE k6_unknown_ref");
      }
      await teardownFixture(pool, manifest);
      expect(
        (await pool.query("SELECT 1 FROM jobs WHERE id=$1", [indexedJob]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
            [indexedPost],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM organizations WHERE id=$1",
            [manifest.organizationId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM users WHERE organization_id=$1",
            [manifest.organizationId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.end();
    }
  }, 120_000);
});
