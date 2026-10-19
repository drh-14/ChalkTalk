import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService, type EmailSender } from "../auth/service.js";
import { createEmailSender } from "../auth/email.js";
import { hashOpaqueToken } from "../auth/crypto.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { createApp } from "../http/app.js";
import {
  createObservability,
  createWorkerMetricsApp,
} from "../observability/index.js";
import { PostService } from "../posts/service.js";
import { DigestService } from "./service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const schema = `digest_${process.pid}_${Date.now()}`;
const secret = "test-secret-that-is-longer-than-thirty-two-characters";
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: secret,
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});

class RecordingSender implements EmailSender {
  messages: Array<{ to: string; subject: string; text: string }> = [];
  fail = false;
  async send(message: { to: string; subject: string; text: string }) {
    if (this.fail) throw new Error("SMTP down");
    this.messages.push(message);
  }
}

let admin: Pool;
let pool: Pool;
let sender: RecordingSender;
let digest: DigestService;
let auth: AuthService;
let migrationCursor: string;
const ids = {
  org: uuidv7(),
  alice: uuidv7(),
  bob: uuidv7(),
  carol: uuidv7(),
  physics: uuidv7(),
  chemistry: uuidv7(),
};
const credential = "digest-session";
const cookie = `__Host-chalktalk_session=${credential}`;
const csrf = hashOpaqueToken(`csrf:${credential}`, secret).toString(
  "base64url",
);

type QueryPlan = {
  "Index Name"?: string;
  Plans?: QueryPlan[];
};
type ExplainRow = { "QUERY PLAN": Array<{ Plan: QueryPlan }> };

function usesIndex(plan: QueryPlan, name: string): boolean {
  return (
    plan["Index Name"] === name ||
    (plan.Plans?.some((child) => usesIndex(child, name)) ?? false)
  );
}

async function addQuestion(
  courseId: string,
  authorId: string,
  at: string,
  title: string,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'question',$4,'Body',$5)",
    [id, courseId, authorId, title, at],
  );
  return id;
}

async function addNote(
  courseId: string,
  authorId: string,
  at: string,
  title: string,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'note',$4,'Body',$5)",
    [id, courseId, authorId, title, at],
  );
  return id;
}

async function addAnswer(
  postId: string,
  courseId: string,
  authorId: string,
  at: string,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor,created_at) VALUES ($1,$2,$3,'student','Answer',$4,'student',$5)",
    [id, courseId, postId, authorId, at],
  );
  return id;
}

async function addFollowup(
  postId: string,
  courseId: string,
  authorId: string,
  at: string,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO followups (id,course_id,post_id,author_user_id,body_markdown,created_at) VALUES ($1,$2,$3,$4,'Followup',$5)",
    [id, courseId, postId, authorId, at],
  );
  return id;
}

integration("daily course email digest", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    migrationCursor = (
      await pool.query<{ date: string }>(
        "SELECT last_scanned_date::text AS date FROM digest_schedule_state",
      )
    ).rows[0]!.date;
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [id, name] of [
      [ids.alice, "Alice"],
      [ids.bob, "Bob"],
      [ids.carol, "Carol"],
    ]) {
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name.toLowerCase()}@example.edu`, name],
      );
    }
    for (const [id, name, code] of [
      [ids.physics, "Physics", "ABCDEFGH"],
      [ids.chemistry, "Chemistry", "BCDEFGHI"],
    ]) {
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5)",
        [id, ids.org, ids.bob, name, code],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'instructor')",
        [id, ids.alice, ids.bob],
      );
    }
    await pool.query(
      "INSERT INTO sessions (id,user_id,credential_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '30 days')",
      [
        uuidv7(),
        ids.alice,
        hashOpaqueToken(credential, secret),
        hashOpaqueToken(csrf, secret),
      ],
    );
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM digest_outbox");
    await pool.query(
      "UPDATE digest_schedule_state SET last_scanned_date='2026-10-13'",
    );
    await pool.query("DELETE FROM followups");
    await pool.query("DELETE FROM answers");
    await pool.query("DELETE FROM posts");
    await pool.query("UPDATE users SET version=1 WHERE id=$1", [ids.alice]);
    await pool.query("UPDATE courses SET status='active'");
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($3,$2,'student') ON CONFLICT DO NOTHING",
      [ids.physics, ids.alice, ids.chemistry],
    );
    sender = new RecordingSender();
    digest = new DigestService(
      pool,
      sender,
      environment.frontendBaseUrl,
      "digest-test",
    );
    auth = new AuthService(pool, environment, sender);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("starts the first digest period on deployment's UTC day", () => {
    const today = new Date().toISOString().slice(0, 10);
    const previous = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(migrationCursor).toBe(previous);
  });

  it("sends to a current member without opt-in and exposes no digest preference", async () => {
    const app = createApp({ environment, authService: auth });
    const profile = await request(app)
      .get("/api/v1/users/me")
      .set("Cookie", cookie);
    expect(profile.status).toBe(200);
    expect(profile.body.data).not.toHaveProperty("dailyDigestEnabled");
    const rejected = await request(app)
      .patch("/api/v1/users/me")
      .set("Cookie", cookie)
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", csrf)
      .set("If-Match", '"v1"')
      .send({ dailyDigestEnabled: false });
    expect(rejected.status).toBe(422);
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Always on",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages[0]?.text).toContain("Always on");
  });

  it("sends distinct course emails for visible external question, answer, and followup creation", async () => {
    const physicsPost = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T08:00:00Z",
      "Physics question",
    );
    await addAnswer(physicsPost, ids.physics, ids.bob, "2026-10-14T09:00:00Z");
    await addFollowup(
      physicsPost,
      ids.physics,
      ids.bob,
      "2026-10-14T10:00:00Z",
    );
    await addQuestion(
      ids.chemistry,
      ids.bob,
      "2026-10-14T11:00:00Z",
      "Chemistry question",
    );
    await addQuestion(
      ids.physics,
      ids.alice,
      "2026-10-14T12:00:00Z",
      "Own question",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    await digest.schedule(new Date("2026-10-15T01:00:00Z"));
    expect(
      (
        await pool.query(
          "SELECT * FROM digest_outbox WHERE recipient_user_id=$1",
          [ids.alice],
        )
      ).rowCount,
    ).toBe(2);
    while (await digest.deliverOnce(new Date("2026-10-15T01:00:00Z"))) {
      // Every active member may have their own course-specific email.
    }
    const aliceMessages = sender.messages.filter(
      (message) => message.to === "alice@example.edu",
    );
    expect(aliceMessages).toHaveLength(2);
    expect(aliceMessages.map((message) => message.subject).sort()).toEqual([
      "ChalkTalk daily digest: Chemistry — 2026-10-14",
      "ChalkTalk daily digest: Physics — 2026-10-14",
    ]);
    expect(
      aliceMessages.find((message) => message.subject.includes("Physics"))
        ?.text,
    ).toContain("1 answer");
    expect(
      aliceMessages.find((message) => message.subject.includes("Physics"))
        ?.text,
    ).toContain("1 followup");
    expect(
      aliceMessages.every((message) => !message.text.includes("Own question")),
    ).toBe(true);
  });

  it("sends a note-only digest as one post with a link", async () => {
    const note = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T09:00:00Z",
      "Lab notes",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.text).toContain(
      "1 post · 0 answers · 0 followups",
    );
    expect(sender.messages[0]?.text).toContain(
      `post: Lab notes\nhttps://app.example.edu/courses/${ids.physics}/posts/${note}`,
    );
  });

  it("combines questions and notes into a posts count while retaining separate answer and followup counts", async () => {
    const question = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T08:00:00Z",
      "Question",
    );
    const note = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T09:00:00Z",
      "Note",
    );
    await addAnswer(question, ids.physics, ids.bob, "2026-10-14T10:00:00Z");
    await addFollowup(question, ids.physics, ids.bob, "2026-10-14T11:00:00Z");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages[0]?.text).toContain(
      "2 posts · 1 answer · 1 followup",
    );
    expect(sender.messages[0]?.text).toContain(`/posts/${question}`);
    expect(sender.messages[0]?.text).toContain(`/posts/${note}`);
  });

  it("does not send the recipient's own or deleted notes", async () => {
    await addNote(ids.physics, ids.alice, "2026-10-14T08:00:00Z", "Own note");
    const deleted = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T09:00:00Z",
      "Deleted note",
    );
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [deleted],
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.to).toBe("bob@example.edu");
    expect(sender.messages[0]?.text).not.toContain("Deleted note");
  });

  it("catches up missed dates but never backfills before deployment", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-13T12:00:00Z",
      "Before deployment",
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Deployment day",
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T12:00:00Z",
      "Second eligible day",
    );
    await digest.schedule(new Date("2026-10-17T08:00:00Z"));
    const rows = await pool.query(
      "SELECT activity_date::text AS date FROM digest_outbox ORDER BY activity_date",
    );
    expect(rows.rows.map((row) => row.date)).toEqual([
      "2026-10-14",
      "2026-10-15",
    ]);
  });

  it("scans posts, answers, and followups within the half-open UTC cursor window", async () => {
    const oldQuestion = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-13T12:00:00Z",
      "Historical parent",
    );
    const priorAnswerQuestion = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-13T11:00:00Z",
      "Prior answer parent",
    );
    await addAnswer(
      priorAnswerQuestion,
      ids.physics,
      ids.bob,
      "2026-10-13T13:00:00Z",
    );
    await addFollowup(
      oldQuestion,
      ids.physics,
      ids.bob,
      "2026-10-13T14:00:00Z",
    );
    const firstNote = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T00:00:00Z",
      "First instant",
    );
    await addAnswer(oldQuestion, ids.physics, ids.bob, "2026-10-14T12:00:00Z");
    await addFollowup(
      oldQuestion,
      ids.physics,
      ids.bob,
      "2026-10-14T23:59:59Z",
    );
    const nextDayQuestion = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T00:00:00Z",
      "Next day",
    );
    await addAnswer(
      nextDayQuestion,
      ids.physics,
      ids.bob,
      "2026-10-15T00:00:00Z",
    );
    await addFollowup(
      nextDayQuestion,
      ids.physics,
      ids.bob,
      "2026-10-15T00:00:00Z",
    );

    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    const dates = await pool.query<{ date: string }>(
      "SELECT activity_date::text AS date FROM digest_outbox ORDER BY activity_date",
    );
    expect(dates.rows.map((row) => row.date)).toEqual(["2026-10-14"]);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const email = sender.messages.find(
      (message) => message.to === "alice@example.edu",
    );
    expect(email?.text).toContain("1 post · 1 answer · 1 followup");
    expect(email?.text).toContain(`/posts/${firstNote}`);
    expect(email?.text).not.toContain("Prior answer parent");
    expect(email?.text).not.toContain("Next day");
  });

  it("can use creation-time indexes for each digest activity source", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET enable_seqscan TO off");
      for (const [query, indexName] of [
        [
          "SELECT created_at FROM posts WHERE type IN ('question','note') AND deleted_at IS NULL AND duplicate_status <> 'confirmed' AND created_at >= $1 AND created_at < $2",
          "posts_digest_created_idx",
        ],
        [
          "SELECT created_at FROM answers WHERE deleted_at IS NULL AND created_at >= $1 AND created_at < $2",
          "answers_digest_created_idx",
        ],
        [
          "SELECT created_at FROM followups WHERE deleted_at IS NULL AND created_at >= $1 AND created_at < $2",
          "followups_digest_created_idx",
        ],
      ]) {
        const result = await client.query<ExplainRow>(
          `EXPLAIN (FORMAT JSON) ${query}`,
          ["2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z"],
        );
        const plan = result.rows[0]!["QUERY PLAN"][0]!.Plan;
        expect(usesIndex(plan, indexName)).toBe(true);
      }
    } finally {
      await client.query("RESET enable_seqscan");
      client.release();
    }
  });

  it("serializes concurrent schedulers using the durable date cursor", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    const peer = new DigestService(
      pool,
      sender,
      environment.frontendBaseUrl,
      "peer",
    );
    await Promise.all([
      digest.schedule(new Date("2026-10-15T00:00:00Z")),
      peer.schedule(new Date("2026-10-15T00:00:00Z")),
    ]);
    expect((await pool.query("SELECT id FROM digest_outbox")).rowCount).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT last_scanned_date::text AS date FROM digest_schedule_state",
        )
      ).rows[0].date,
    ).toBe("2026-10-14");
  });

  it("waits for a coordinated late content commit before advancing the cursor", async () => {
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR SHARE",
      );
      await writer.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'question','Late commit','Body','2026-10-14T23:59:59Z')",
        [uuidv7(), ids.physics, ids.bob],
      );
      await writer.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'note','Late note','Body','2026-10-14T23:59:59Z')",
        [uuidv7(), ids.physics, ids.bob],
      );
      let scanned = false;
      const scan = digest
        .schedule(new Date("2026-10-15T00:00:00Z"))
        .then((count) => {
          scanned = true;
          return count;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scanned).toBe(false);
      await writer.query("COMMIT");
      expect(await scan).toBe(1);
      await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
      expect(sender.messages[0]?.text).toContain("2 posts");
      expect(sender.messages[0]?.text).toContain("Late commit");
      expect(sender.messages[0]?.text).toContain("Late note");
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });

  it("does not revive a canceled historical digest after access returns", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Old question",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.physics, ids.alice],
    );
    const canceledAfter = (
      await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const canceled = await pool.query<{ updated_at: Date }>(
      "SELECT updated_at FROM digest_outbox",
    );
    const canceledBefore = (
      await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    expect(canceled.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
      canceledAfter.getTime(),
    );
    expect(canceled.rows[0]!.updated_at.getTime()).toBeLessThanOrEqual(
      canceledBefore.getTime(),
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'student')",
      [ids.physics, ids.alice],
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T12:00:00Z",
      "New question",
    );
    expect(await digest.schedule(new Date("2026-10-16T00:00:00Z"))).toBe(1);
    const rows = await pool.query<{ date: string; status: string }>(
      "SELECT activity_date::text AS date,status FROM digest_outbox ORDER BY activity_date",
    );
    expect(rows.rows).toEqual([
      { date: "2026-10-14", status: "canceled" },
      { date: "2026-10-15", status: "queued" },
    ]);
    await digest.deliverOnce(new Date("2026-10-16T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.text).toContain("New question");
    expect(sender.messages[0]?.text).not.toContain("Old question");
  });

  it("waits for the digest scheduling cursor before committing a note", async () => {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR UPDATE",
    );
    const posts = new PostService(pool);
    const note = posts.create(ids.physics, ids.bob, {
      type: "note",
      title: "Digest note",
      bodyMarkdown: "Body",
    });
    try {
      const completed = await Promise.race([
        note.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      expect(completed).toBe(false);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await note;
    }
    const { value } = await note;
    expect(value.updatedAt).toBe(value.createdAt);
    expect(value.lastActivityAt).toBe(value.createdAt);
  });

  it("records SMTP completion and bases retries on completion time", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    let finishedAt!: Date;
    sender.send = async () => {
      finishedAt = (
        await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
      ).rows[0]!.at;
      throw new Error("SMTP down");
    };
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const retry = await pool.query<{ available_at: Date; updated_at: Date }>(
      "SELECT available_at,updated_at FROM digest_outbox",
    );
    const retryBefore = (
      await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    expect(retry.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
      finishedAt.getTime(),
    );
    expect(retry.rows[0]!.updated_at.getTime()).toBeLessThanOrEqual(
      retryBefore.getTime(),
    );
    expect(
      retry.rows[0]!.available_at.getTime() -
        retry.rows[0]!.updated_at.getTime(),
    ).toBeGreaterThanOrEqual(1900);
    sender.send = async (message) => {
      finishedAt = (
        await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
      ).rows[0]!.at;
      sender.messages.push(message);
    };
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    const sent = await pool.query<{ sent_at: Date }>(
      "SELECT sent_at FROM digest_outbox",
    );
    const sentBefore = (
      await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    expect(sent.rows[0]!.sent_at.getTime()).toBeGreaterThanOrEqual(
      finishedAt.getTime(),
    );
    expect(sent.rows[0]!.sent_at.getTime()).toBeLessThanOrEqual(
      sentBefore.getTime(),
    );
  });

  it("holds course access and content through an in-flight SMTP handoff", async () => {
    const post = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Question",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    let started!: () => void;
    let release!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    sender.send = async (message) => {
      started();
      await held;
      sender.messages.push(message);
    };
    const delivery = digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    await sending;
    const changes = [
      pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        ids.physics,
      ]),
      pool.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [ids.physics, ids.alice],
      ),
      pool.query(
        "UPDATE posts SET deleted_at=now(),title=NULL,body_markdown=NULL,author_user_id=NULL WHERE id=$1",
        [post],
      ),
    ];
    const completed = changes.map(() => false);
    const revocations = Promise.all(
      changes.map((change, index) =>
        change.then(() => {
          completed[index] = true;
        }),
      ),
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(completed).toEqual([false, false, false]);
      expect(sender.messages).toHaveLength(0);
    } finally {
      release();
    }
    await delivery;
    await revocations;
    expect(sender.messages).toHaveLength(1);
    expect(
      (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
    ).toBe("sent");
  });

  it("does not reclaim a slow active SMTP attempt after its lease expires", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    let started!: () => void;
    let release!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    sender.send = async (message) => {
      started();
      await held;
      sender.messages.push(message);
    };
    const delivery = digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    await sending;
    const peer = new DigestService(
      pool,
      sender,
      environment.frontendBaseUrl,
      "peer",
    );
    try {
      expect(await peer.deliverOnce(new Date("2026-10-15T00:03:01Z"))).toBe(
        false,
      );
    } finally {
      release();
    }
    await delivery;
    expect(sender.messages).toHaveLength(1);
  });

  it("rechecks access and content before SMTP and retries failures", async () => {
    const post = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Question",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.fail = true;
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
      true,
    );
    expect(sender.messages).toHaveLength(0);
    expect(
      (await pool.query("SELECT status,attempts,last_error FROM digest_outbox"))
        .rows[0],
    ).toMatchObject({ status: "queued", attempts: 1, last_error: "SMTP down" });
    sender.fail = false;
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [post],
    );
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.messages).toHaveLength(0);
    expect(
      (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
    ).toBe("canceled");
  });

  it("records digest delivery outcomes at the retry boundary without email content", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Sensitive digest title",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    const events: string[] = [];
    const observability = createObservability({
      token: "digest-test-operator-token-long-enough",
      stdout: (line) => events.push(line),
    });
    const observedDigest = new DigestService(
      pool,
      sender,
      environment.frontendBaseUrl,
      "digest-observed",
      observability,
    );
    try {
      sender.fail = true;
      expect(
        await observedDigest.deliverOnce(new Date("2026-10-15T00:00:01Z")),
      ).toBe(true);
      expect(
        (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
      ).toBe("queued");
      expect(
        await observedDigest.deliverOnce(new Date("2026-10-15T00:00:01Z")),
      ).toBe(false);
      sender.fail = false;
      await pool.query(
        "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
      );
      expect(
        await observedDigest.deliverOnce(new Date("2026-10-15T00:00:03Z")),
      ).toBe(true);
      expect(
        (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
      ).toBe("sent");
      const metrics = await request(createWorkerMetricsApp(observability))
        .get("/metrics")
        .set("Authorization", "Bearer digest-test-operator-token-long-enough");
      expect(metrics.text).toContain(
        'chalktalk_jobs_total{kind="digest_delivery",outcome="failed"} 1',
      );
      expect(metrics.text).toContain(
        'chalktalk_jobs_total{kind="digest_delivery",outcome="succeeded"} 1',
      );
      expect(
        events.filter((line) => line.includes('"event":"job_start"')),
      ).toHaveLength(2);
      expect(events.join("\n")).not.toContain("Sensitive digest title");
      expect(events.join("\n")).not.toContain("alice@example.edu");
      expect(events.join("\n")).not.toContain("SMTP down");
    } finally {
      await observability.close();
    }
  });

  it("waits until UTC midnight and uses half-open UTC dates", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T23:59:59.999Z",
      "Last millisecond",
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T00:00:00.000Z",
      "Next day",
    );
    expect(await digest.schedule(new Date("2026-10-14T23:59:59.999Z"))).toBe(0);
    expect(await digest.schedule(new Date("2026-10-15T00:00:00.000Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages[0]?.text).toContain("Last millisecond");
    expect(sender.messages[0]?.text).not.toContain("Next day");
    expect(await digest.schedule(new Date("2026-10-16T00:00:00Z"))).toBe(1);
  });

  it("omits confirmed duplicates, hidden answers and deleted followup tombstones but includes notes", async () => {
    const source = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T01:00:00Z",
      "Hidden parent",
    );
    await addAnswer(source, ids.physics, ids.bob, "2026-10-14T02:00:00Z");
    await addFollowup(source, ids.physics, ids.bob, "2026-10-14T03:00:00Z");
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [source],
    );
    const canonical = await addQuestion(
      ids.physics,
      ids.alice,
      "2026-10-14T04:00:00Z",
      "Own canonical",
    );
    const duplicate = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T05:00:00Z",
      "Duplicate",
    );
    await pool.query(
      "UPDATE posts SET duplicate_of_post_id=$1,duplicate_status='confirmed' WHERE id=$2",
      [canonical, duplicate],
    );
    const note = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T06:00:00Z",
      "A note",
    );
    // Bob sees Alice's question; Alice sees only Bob's note.
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT id FROM digest_outbox WHERE recipient_user_id=$1",
          [ids.alice],
        )
      ).rowCount,
    ).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const aliceEmail = sender.messages.find(
      (message) => message.to === "alice@example.edu",
    );
    expect(aliceEmail?.text).toContain("1 post");
    expect(aliceEmail?.text).toContain(
      `https://app.example.edu/courses/${ids.physics}/posts/${note}`,
    );
    expect(aliceEmail?.text).not.toContain("Hidden parent");
    expect(aliceEmail?.text).not.toContain("Duplicate");
  });

  it("rechecks course archive and membership before send", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T01:00:00Z", "Physics");
    await addQuestion(
      ids.chemistry,
      ids.bob,
      "2026-10-14T01:00:00Z",
      "Chemistry",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(2);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.physics,
    ]);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.chemistry, ids.alice],
    );
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages).toHaveLength(0);
    expect(
      (
        await pool.query("SELECT status FROM digest_outbox ORDER BY id")
      ).rows.map((row) => row.status),
    ).toEqual(["canceled", "canceled"]);
  });

  it("reclaims an expired lease without queuing a second intent", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T01:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    await pool.query(
      "UPDATE digest_outbox SET status='running',locked_by='dead-worker',locked_until='2026-10-15T00:00:00Z'",
    );
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
      true,
    );
    expect(sender.messages).toHaveLength(1);
    expect(
      (await pool.query("SELECT status,attempts FROM digest_outbox")).rows[0],
    ).toMatchObject({ status: "sent", attempts: 1 });
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:02Z"))).toBe(
      false,
    );
  });

  (process.env.MAILPIT_SMOKE ? it : it.skip)(
    "captures note-only and mixed UTC digests in Mailpit without sending empty mail",
    async () => {
      const before = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number };
      const note = await addNote(
        ids.physics,
        ids.bob,
        "2026-10-14T23:59:59.999Z",
        "Mailpit note-only",
      );
      const question = await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-15T00:00:00Z",
        "Mailpit mixed question",
      );
      const mixedNote = await addNote(
        ids.physics,
        ids.bob,
        "2026-10-15T12:00:00Z",
        "Mailpit mixed note",
      );
      await addAnswer(question, ids.physics, ids.bob, "2026-10-15T13:00:00Z");
      await addFollowup(question, ids.physics, ids.bob, "2026-10-15T14:00:00Z");
      await addNote(ids.physics, ids.alice, "2026-10-15T15:00:00Z", "Own note");
      const duplicate = await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-15T15:30:00Z",
        "Confirmed duplicate",
      );
      await pool.query(
        "UPDATE posts SET duplicate_of_post_id=$1,duplicate_status='confirmed' WHERE id=$2",
        [question, duplicate],
      );
      const deleted = await addNote(
        ids.physics,
        ids.bob,
        "2026-10-15T16:00:00Z",
        "Deleted note",
      );
      await pool.query(
        "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
        [deleted],
      );
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-smoke",
      );
      expect(await live.schedule(new Date("2026-10-14T23:59:59.999Z"))).toBe(0);
      expect(await live.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
      expect(await live.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
        true,
      );
      expect(await live.schedule(new Date("2026-10-16T00:00:00Z"))).toBe(2);
      while (await live.deliverOnce(new Date("2026-10-16T00:00:01Z"))) {
        // Alice receives the mixed digest; Bob receives Alice's own note.
      }
      const after = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as {
        total: number;
        messages: Array<{
          ID: string;
          Subject: string;
          To: Array<{ Address: string }>;
        }>;
      };
      expect(after.total).toBe(before.total + 3);
      const messages = await Promise.all(
        after.messages.slice(0, 3).map(
          async ({ ID }) =>
            (await fetch(`http://localhost:8025/api/v1/message/${ID}`).then(
              (response) => response.json(),
            )) as {
              Subject: string;
              Text: string;
              To: Array<{ Address: string }>;
            },
        ),
      );
      const alice = messages.filter(
        (message) => message.To[0]?.Address === "alice@example.edu",
      );
      expect(alice).toHaveLength(2);
      const noteOnly = alice.find((message) =>
        message.Subject.endsWith("2026-10-14"),
      );
      expect(noteOnly?.Text).toContain("1 post · 0 answers · 0 followups");
      expect(noteOnly?.Text).toContain(`/posts/${note}`);
      expect(noteOnly?.Text).not.toContain("Mailpit mixed question");
      const mixed = alice.find((message) =>
        message.Subject.endsWith("2026-10-15"),
      );
      expect(mixed?.Text).toContain("2 posts · 1 answer · 1 followup");
      expect(mixed?.Text).toContain(`/posts/${question}`);
      expect(mixed?.Text).toContain(`/posts/${mixedNote}`);
      expect(mixed?.Text).not.toContain("Own note");
      expect(mixed?.Text).not.toContain("Deleted note");
      expect(mixed?.Text).not.toContain("Confirmed duplicate");
      await live.schedule(new Date("2026-10-17T00:00:00Z"));
      expect(await live.deliverOnce(new Date("2026-10-16T00:00:01Z"))).toBe(
        false,
      );
      const empty = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number };
      expect(empty.total).toBe(after.total);
    },
  );

  (process.env.MAILPIT_SMOKE ? it : it.skip)(
    "delivers a late midnight note through the durable retry outbox",
    async () => {
      const before = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number };
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-retry",
      );
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN");
        await writer.query(
          "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR SHARE",
        );
        const note = await writer.query<{ id: string }>(
          "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'note','Late midnight note','Body','2026-10-14T23:59:59.999Z') RETURNING id",
          [uuidv7(), ids.physics, ids.bob],
        );
        let finished = false;
        const scan = live
          .schedule(new Date("2026-10-15T00:00:00Z"))
          .then((count) => {
            finished = true;
            return count;
          });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(finished).toBe(false);
        await writer.query("COMMIT");
        expect(await scan).toBe(1);
        const unavailable = new DigestService(
          pool,
          createEmailSender({
            ...environment,
            smtp: { ...environment.smtp, port: 1 },
          }),
          environment.frontendBaseUrl,
          "mailpit-unavailable",
        );
        expect(
          await unavailable.deliverOnce(new Date("2026-10-15T00:00:01Z")),
        ).toBe(true);
        expect(
          (
            await pool.query(
              "SELECT status,attempts FROM digest_outbox WHERE recipient_user_id=$1",
              [ids.alice],
            )
          ).rows[0],
        ).toMatchObject({ status: "queued", attempts: 1 });
        await pool.query(
          "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z' WHERE recipient_user_id=$1",
          [ids.alice],
        );
        expect(await live.deliverOnce(new Date("2026-10-15T00:00:03Z"))).toBe(
          true,
        );
        expect(
          (
            await pool.query(
              "SELECT status,attempts FROM digest_outbox WHERE recipient_user_id=$1",
              [ids.alice],
            )
          ).rows[0],
        ).toMatchObject({ status: "sent", attempts: 2 });
        const after = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((response) => response.json())) as {
          total: number;
          messages: Array<{ ID: string }>;
        };
        expect(after.total).toBe(before.total + 1);
        const delivered = (await fetch(
          `http://localhost:8025/api/v1/message/${after.messages[0]!.ID}`,
        ).then((response) => response.json())) as { Text: string };
        expect(delivered.Text).toContain(`post: Late midnight note`);
        expect(delivered.Text).toContain(`/posts/${note.rows[0]!.id}`);
        await addNote(
          ids.physics,
          ids.bob,
          "2026-10-15T12:00:00Z",
          "Revoked member note",
        );
        expect(await live.schedule(new Date("2026-10-16T00:00:00Z"))).toBe(1);
        await pool.query(
          "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
          [ids.physics, ids.alice],
        );
        expect(await live.deliverOnce(new Date("2026-10-16T00:00:01Z"))).toBe(
          true,
        );
        expect(
          (
            await pool.query(
              "SELECT status FROM digest_outbox WHERE recipient_user_id=$1 AND activity_date='2026-10-15'",
              [ids.alice],
            )
          ).rows[0]?.status,
        ).toBe("canceled");
        await pool.query(
          "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'student')",
          [ids.physics, ids.alice],
        );
        await addNote(
          ids.physics,
          ids.bob,
          "2026-10-16T12:00:00Z",
          "Archived course note",
        );
        expect(await live.schedule(new Date("2026-10-17T00:00:00Z"))).toBe(1);
        await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
          ids.physics,
        ]);
        expect(await live.deliverOnce(new Date("2026-10-17T00:00:01Z"))).toBe(
          true,
        );
        expect(
          (
            await pool.query(
              "SELECT status FROM digest_outbox WHERE recipient_user_id=$1 AND activity_date='2026-10-16'",
              [ids.alice],
            )
          ).rows[0]?.status,
        ).toBe("canceled");
        const final = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((response) => response.json())) as { total: number };
        expect(final.total).toBe(before.total + 1);
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
      }
    },
  );
});
