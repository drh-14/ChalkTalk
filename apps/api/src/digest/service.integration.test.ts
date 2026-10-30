import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { s3DigestImageReader } from "./images.js";
import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService, type EmailSender } from "../auth/service.js";
import {
  createEmailSender,
  PermanentEmailDeliveryError,
} from "../auth/email.js";
import { hashOpaqueToken } from "../auth/crypto.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
} from "../config/environment.js";
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
  messages: Array<Parameters<EmailSender["send"]>[0]> = [];
  attempts: Array<{
    message: Parameters<EmailSender["send"]>[0];
    key?: string;
  }> = [];
  fail = false;
  async send(
    message: Parameters<EmailSender["send"]>[0],
    options?: Parameters<EmailSender["send"]>[1],
  ) {
    this.attempts.push({ message, key: options?.idempotencyKey });
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

  it("renders each activity's own formatted preview and local equation images", async () => {
    const question = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T12:00:00Z",
      "Rendered question",
    );
    const answer = await addAnswer(
      question,
      ids.physics,
      ids.bob,
      "2026-10-15T13:00:00Z",
    );
    const followup = await addFollowup(
      question,
      ids.physics,
      ids.bob,
      "2026-10-15T14:00:00Z",
    );
    await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
      "Question **bold**",
      question,
    ]);
    await pool.query("UPDATE answers SET body_markdown=$1 WHERE id=$2", [
      "Answer $x^2$",
      answer,
    ]);
    await pool.query("UPDATE followups SET body_markdown=$1 WHERE id=$2", [
      "Followup *italic*",
      followup,
    ]);
    await digest.schedule(new Date("2026-10-16T00:00:00Z"));
    await digest.deliverOnce(new Date("2026-10-16T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0].html).toContain("Question <strong>bold</strong>");
    expect(sender.messages[0].html).toContain("Followup <em>italic</em>");
    expect(sender.messages[0].html).toContain('src="cid:');
    expect(sender.messages[0].attachments).toHaveLength(1);
    expect(sender.messages[0].text).toContain("Answer x^2");
    expect(sender.messages[0].text).not.toContain("post:");
  });

  it("links byte-clipped source for posts, answers, and followups", async () => {
    const question = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-15T12:00:00Z",
      "Source-bound question",
    );
    const answer = await addAnswer(
      question,
      ids.physics,
      ids.bob,
      "2026-10-15T13:00:00Z",
    );
    const followup = await addFollowup(
      question,
      ids.physics,
      ids.bob,
      "2026-10-15T14:00:00Z",
    );
    const complete = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-15T15:00:00Z",
      "Complete boundary note",
    );
    const prefix = "Visible\n\n<!--" + "😀".repeat(32760) + "-->";
    const body =
      prefix +
      " ".repeat(131072 - Buffer.byteLength(prefix)) +
      "Omitted suffix";
    for (const [table, id] of [
      ["posts", question],
      ["answers", answer],
      ["followups", followup],
    ] as const)
      await pool.query(`UPDATE ${table} SET body_markdown=$1 WHERE id=$2`, [
        body,
        id,
      ]);
    await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
      "Visible" + " ".repeat(100000 - "Visible".length),
      complete,
    ]);

    await digest.schedule(new Date("2026-10-16T00:00:00Z"));
    await digest.deliverOnce(new Date("2026-10-16T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    const articles = sender.messages[0].html!.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/g,
    )!;
    expect(articles).toHaveLength(4);
    for (const article of articles.slice(0, 3)) {
      expect(article).toContain("Visible");
      expect(article).not.toContain("Omitted suffix");
      expect(article).toContain("Read more</a>");
    }
    expect(articles[3]).toContain("Complete boundary note");
    expect(articles[3]).not.toContain("Read more");
  });

  it("preserves complete course-day counts when only fifty entries are included", async () => {
    const postIds = Array.from({ length: 55 }, () => uuidv7());
    await pool.query(
      `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at)
      SELECT id,$1,$2,'note','Note ' || ordinality,'Body','2026-10-15T12:00:00Z'::timestamptz
      FROM unnest($3::uuid[]) WITH ORDINALITY AS fixture(id,ordinality)`,
      [ids.physics, ids.bob, postIds],
    );
    await digest.schedule(new Date("2026-10-16T00:00:00Z"));
    await digest.deliverOnce(new Date("2026-10-16T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0].text).toContain("55 posts");
    expect(sender.messages[0].html!.match(/<article/g)).toHaveLength(50);
    expect(sender.messages[0].html).toContain("View remaining activity");
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
    await pool.query("UPDATE users SET email='alice@example.edu' WHERE id=$1", [
      ids.alice,
    ]);
    await pool.query("UPDATE courses SET status='active'");
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($3,$2,'student') ON CONFLICT DO NOTHING",
      [ids.physics, ids.alice, ids.chemistry],
    );
    await pool.query("UPDATE course_memberships SET digest_emails=true");
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

  it("honors per-course digest opt-out after schedule but before delivery", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Physics update",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await pool.query(
      "UPDATE course_memberships SET digest_emails=false WHERE course_id=$1 AND user_id=$2",
      [ids.physics, ids.alice],
    );
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages).toEqual([]);
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
      `Lab notes\nBody\nhttps://app.example.edu/courses/${ids.physics}/posts/${note}`,
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

  it("cancels a permanently rejected digest and clears its frozen content", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.send = async () => {
      throw new PermanentEmailDeliveryError(
        "Resend rejected email: invalid_request",
      );
    };
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
      true,
    );
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox")).rows,
    ).toEqual([{ status: "canceled", frozen_email: null }]);
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

  it("freezes digest bytes and key before a failed handoff, then retries exactly", async () => {
    const post = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Original title",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.fail = true;
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const stored = await pool.query<{ frozen_email: unknown; id: string }>(
      "SELECT id,frozen_email FROM digest_outbox",
    );
    expect(stored.rows[0]!.frozen_email).toBeTruthy();
    expect(sender.attempts).toHaveLength(1);
    await pool.query("UPDATE posts SET title='Edited title' WHERE id=$1", [
      post,
    ]);
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    sender.fail = false;
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.attempts).toHaveLength(2);
    expect(sender.attempts[1]).toEqual(sender.attempts[0]);
    expect(sender.attempts[1]!.key).toBe(`digest-${stored.rows[0]!.id}`);
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
        .rows[0],
    ).toMatchObject({
      status: "sent",
      frozen_email: null,
    });
  });

  it.each([
    [
      "recipient email changes",
      async (post: string) => {
        void post;
        await pool.query(
          "UPDATE users SET email='alice-new@example.edu' WHERE id=$1",
          [ids.alice],
        );
      },
    ],
    [
      "body changes",
      async (post: string) => {
        await pool.query(
          "UPDATE posts SET body_markdown='Revised body' WHERE id=$1",
          [post],
        );
      },
    ],
    [
      "content becomes private",
      async (post: string) => {
        await pool.query("UPDATE posts SET private=true WHERE id=$1", [post]);
      },
    ],
    [
      "content is deleted",
      async (post: string) => {
        await pool.query(
          "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
          [post],
        );
      },
    ],
    [
      "course is archived",
      async (_post: string) => {
        void _post;
        await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
          ids.physics,
        ]);
      },
    ],
    [
      "recipient opts out",
      async (_post: string) => {
        void _post;
        await pool.query(
          "UPDATE course_memberships SET digest_emails=false WHERE course_id=$1 AND user_id=$2",
          [ids.physics, ids.alice],
        );
      },
    ],
    [
      "recipient leaves course",
      async (_post: string) => {
        void _post;
        await pool.query(
          "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
          [ids.physics, ids.alice],
        );
      },
    ],
  ])("cancels a frozen digest when %s", async (_reason, invalidate) => {
    const post = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Question",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.fail = true;
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.attempts).toHaveLength(1);
    await invalidate(post);
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    sender.fail = false;
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.attempts).toHaveLength(1);
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
        .rows[0],
    ).toMatchObject({
      status: "canceled",
      frozen_email: null,
    });
  });

  it("cancels the whole frozen digest when one of several items is edited", async () => {
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Question one",
    );
    const second = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T13:00:00Z",
      "Question two",
    );
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.fail = true;
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    await pool.query("UPDATE posts SET body_markdown='Changed' WHERE id=$1", [
      second,
    ]);
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    sender.fail = false;
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.attempts).toHaveLength(1);
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
        .rows[0],
    ).toMatchObject({
      status: "canceled",
      frozen_email: null,
    });
  });

  it("retries a frozen digest after an unembedded image is removed", async () => {
    const post = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "Image question",
    );
    const image = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "red",
      },
    })
      .png()
      .toBuffer();
    const attachmentIds = Array.from({ length: 6 }, () => uuidv7());
    for (const id of attachmentIds) {
      await pool.query(
        "INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$1,'image.png','image/png',$4,$5)",
        [
          id,
          ids.physics,
          post,
          image.length,
          createHash("sha256").update(image).digest(),
        ],
      );
    }
    const imageDigest = new DigestService(
      pool,
      sender,
      environment.frontendBaseUrl,
      "image-retry",
      undefined,
      async () => image,
    );
    await imageDigest.schedule(new Date("2026-10-15T00:00:00Z"));
    sender.fail = true;
    await imageDigest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    const frozen = await pool.query<{ frozen_email: { attachmentIds: string[] } }>(
      "SELECT frozen_email FROM digest_outbox",
    );
    expect(frozen.rows[0]!.frozen_email.attachmentIds).toEqual(
      attachmentIds.slice(0, 5),
    );
    await pool.query(
      "UPDATE content_attachments SET deleted_at=now() WHERE id=$1",
      [attachmentIds[5]],
    );
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    sender.fail = false;
    await imageDigest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.attempts).toHaveLength(2);
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0].attachments).toHaveLength(5);
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
        .rows[0],
    ).toEqual({ status: "sent", frozen_email: null });
  });

  it.each(["answer", "followup"] as const)(
    "cancels a frozen digest after an included %s body edit",
    async (kind) => {
      const post = await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-14T12:00:00Z",
        "Question",
      );
      const response =
        kind === "answer"
          ? await addAnswer(post, ids.physics, ids.bob, "2026-10-14T13:00:00Z")
          : await addFollowup(
              post,
              ids.physics,
              ids.bob,
              "2026-10-14T13:00:00Z",
            );
      await digest.schedule(new Date("2026-10-15T00:00:00Z"));
      sender.fail = true;
      await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
      await pool.query(
        `UPDATE ${kind === "answer" ? "answers" : "followups"} SET body_markdown='Revised' WHERE id=$1`,
        [response],
      );
      await pool.query(
        "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
      );
      sender.fail = false;
      await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
      expect(sender.attempts).toHaveLength(1);
      expect(
        (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
          .rows[0],
      ).toMatchObject({ status: "canceled", frozen_email: null });
    },
  );

  it("retries an ambiguous accepted-then-dropped handoff with the same payload and key", async () => {
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    let attempt = 0;
    sender.send = async (message, options) => {
      sender.attempts.push({ message, key: options?.idempotencyKey });
      if (++attempt === 1)
        throw new Error("response connection dropped after acceptance");
      sender.messages.push(message);
    };
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(
      (await pool.query("SELECT status,frozen_email FROM digest_outbox"))
        .rows[0],
    ).toMatchObject({
      status: "queued",
      frozen_email: expect.any(Object),
    });
    await pool.query(
      "UPDATE digest_outbox SET available_at='2026-10-15T00:00:02Z'",
    );
    await digest.deliverOnce(new Date("2026-10-15T00:00:03Z"));
    expect(sender.attempts).toHaveLength(2);
    expect(sender.attempts[1]).toEqual(sender.attempts[0]);
    expect(sender.messages).toHaveLength(1);
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

  it("leaves private posts and their answers and followups out of every digest", async () => {
    const hidden = await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T01:00:00Z",
      "Private grade question",
    );
    await pool.query("UPDATE posts SET private=true WHERE id=$1", [hidden]);
    await addAnswer(hidden, ids.physics, ids.bob, "2026-10-14T02:00:00Z");
    await addFollowup(hidden, ids.physics, ids.bob, "2026-10-14T03:00:00Z");
    const note = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T04:00:00Z",
      "Public note",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.text).toContain(
      "1 post · 0 answers · 0 followups",
    );
    expect(sender.messages[0]?.text).toContain(`/posts/${note}`);
    expect(sender.messages[0]?.text).not.toContain("Private grade question");
  });

  it("leaves a scheduled announcement out of every digest", async () => {
    const scheduled = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T01:00:00Z",
      "Not yet announced",
    );
    await pool.query(
      "UPDATE posts SET announcement=true,scheduled_for='2026-12-01T09:00:00Z' WHERE id=$1",
      [scheduled],
    );
    const note = await addNote(
      ids.physics,
      ids.bob,
      "2026-10-14T02:00:00Z",
      "Visible note",
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(1);
    await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
    expect(sender.messages[0]?.text).toContain(`/posts/${note}`);
    expect(sender.messages[0]?.text).not.toContain("Not yet announced");
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

  (process.env.MAILPIT_SMOKE && process.env.S3_ENDPOINT ? it : it.skip)(
    "sends a real MIME digest with equation and course-image CID copies while omitting private/deleted attachments",
    async () => {
      const storage = loadObjectStorageConfig();
      const s3 = new S3Client(storage.client);
      const bucket = `digest-rich-${process.pid}-${Date.now()}`;
      const key = "approved-image.png";
      const unique = `How does integration by parts work? (${process.pid})`;
      let mailId: string | undefined;
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        const image = await sharp(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="320"><rect width="800" height="320" fill="#f3faf5"/><path d="M60 270H750M60 270V30" fill="none" stroke="#59675d" stroke-width="3"/><path d="M60 265C220 262 400 240 520 190S670 80 740 35" fill="none" stroke="#17814c" stroke-width="7"/><text x="560" y="90" font-family="sans-serif" font-size="25" fill="#17814c">y = x exp(x)</text></svg>',
          ),
        )
          .png()
          .toBuffer();
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: image,
            ContentType: "image/png",
          }),
        );
        const post = await addQuestion(
          ids.physics,
          ids.bob,
          "2026-10-15T12:00:00Z",
          unique,
        );
        await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
          "I tried **integration by parts** on $x e^x$.\n\n- Choose the two factors.\n- Compare with the curve below.\n\n$$\\int x e^x \\,dx = x e^x - \\int e^x \\,dx$$",
          post,
        ]);
        await pool.query(
          "INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,'diagram.png','image/png',$5,$6)",
          [
            uuidv7(),
            ids.physics,
            post,
            key,
            image.length,
            createHash("sha256").update(image).digest(),
          ],
        );
        const hidden = await addQuestion(
          ids.physics,
          ids.bob,
          "2026-10-15T13:00:00Z",
          "Private image title",
        );
        await pool.query("UPDATE posts SET private=true WHERE id=$1", [hidden]);
        await pool.query(
          "INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'denied.png','secret-image-name.png','image/png',$4,$5)",
          [
            uuidv7(),
            ids.physics,
            hidden,
            image.length,
            createHash("sha256").update(image).digest(),
          ],
        );
        await pool.query(
          "INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256,deleted_at) VALUES ($1,$2,$3,'deleted.png','deleted-image-name.png','image/png',$4,$5,now())",
          [
            uuidv7(),
            ids.physics,
            post,
            image.length,
            createHash("sha256").update(image).digest(),
          ],
        );
        const live = new DigestService(
          pool,
          createEmailSender(environment),
          environment.frontendBaseUrl,
          "rich-mailpit",
          undefined,
          s3DigestImageReader(s3, bucket),
        );
        await live.schedule(new Date("2026-10-16T00:00:00Z"));
        await live.deliverOnce(new Date("2026-10-16T00:00:01Z"));
        const listing = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((r) => r.json())) as { messages: Array<{ ID: string }> };
        let message:
          | {
              HTML: string;
              Text: string;
              Inline: Array<{
                ContentID: string;
                ContentType: string;
                PartID: string;
                Size: number;
              }>;
            }
          | undefined;
        for (const item of listing.messages) {
          const found = await fetch(
            `http://localhost:8025/api/v1/message/${item.ID}`,
          ).then((r) => r.json());
          if (found.Text?.includes(unique)) {
            mailId = item.ID;
            message = found;
            break;
          }
        }
        expect(message).toBeDefined();
        expect(message!.HTML).toContain(
          "<strong>integration by parts</strong>",
        );
        expect(message!.HTML).not.toContain("Read more");
        expect(message!.HTML).toContain('src="cid:equation-');
        expect(message!.HTML).toContain('src="cid:attachment-');
        expect(message!.HTML).not.toMatch(
          /secret-image-name|deleted-image-name|Private image title/,
        );
        expect(message!.Inline).toHaveLength(3);
        if (process.env.TEST_EVIDENCE_DIR) {
          const { chromium } = await import("@playwright/test");
          const browser = await chromium.launch({ headless: true });
          try {
            await mkdir(process.env.TEST_EVIDENCE_DIR, { recursive: true });
            for (const [name, viewport] of [
              ["desktop", { width: 1280, height: 1000 }],
              ["mobile", { width: 390, height: 844 }],
            ] as const) {
              const page = await browser.newPage({ viewport });
              await page.goto(`http://localhost:8025/view/${mailId}`);
              const frame = page.frameLocator("#preview-html");
              await frame.getByRole("heading", { name: unique }).waitFor();
              const images = frame.locator("img");
              expect(await images.count()).toBe(3);
              await images.evaluateAll((nodes) =>
                Promise.all(
                  nodes.map((node) => (node as HTMLImageElement).decode()),
                ),
              );
              expect(
                await images.evaluateAll((nodes) =>
                  nodes.every(
                    (node) => (node as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
              ).toBe(true);
              expect(await frame.locator("strong").textContent()).toBe(
                "integration by parts",
              );
              await page.locator("#preview-html").screenshot({
                path: join(
                  process.env.TEST_EVIDENCE_DIR,
                  `rich-digest-${name}.png`,
                ),
              });
              await page.close();
            }
          } finally {
            await browser.close();
          }
        }

        for (const inline of message!.Inline) {
          expect(inline.ContentType).toBe("image/png");
          expect(inline.Size).toBeGreaterThan(100);
          const bytes = Buffer.from(
            await fetch(
              `http://localhost:8025/api/v1/message/${mailId}/part/${inline.PartID}`,
            ).then((r) => r.arrayBuffer()),
          );
          expect((await sharp(bytes).metadata()).format).toBe("png");
        }
      } finally {
        if (mailId)
          await fetch(`http://localhost:8025/api/v1/messages`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: [mailId] }),
          });
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        s3.destroy();
      }
    },
    30_000,
  );

  (process.env.MAILPIT_SMOKE ? it : it.skip)(
    "delivers separated plain-text block boundaries in the real MIME digest",
    async () => {
      const title = `Block boundary email ${process.pid}`;
      const post = await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-15T12:00:00Z",
        title,
      );
      await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
        "Before<p>After</p><h4>Step</h4><p>Apply the rule</p>",
        post,
      ]);
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-block-boundaries",
      );
      let mailId: string | undefined;
      try {
        await live.schedule(new Date("2026-10-16T00:00:00Z"));
        await live.deliverOnce(new Date("2026-10-16T00:00:01Z"));
        const listing = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((response) => response.json())) as {
          messages: Array<{ ID: string }>;
        };
        for (const item of listing.messages) {
          const message = (await fetch(
            `http://localhost:8025/api/v1/message/${item.ID}`,
          ).then((response) => response.json())) as {
            Text: string;
            HTML: string;
          };
          if (!message.Text?.includes(title)) continue;
          mailId = item.ID;
          expect(message.Text).toMatch(
            /Before\s+After\s+Step\s+Apply the rule/,
          );
          expect(message.Text).not.toContain("BeforeAfter");
          expect(message.Text).not.toContain("StepApply");
          expect(message.HTML).toContain("<h4>Step</h4><p>Apply the rule</p>");
          if (process.env.TEST_EVIDENCE_DIR) {
            await mkdir(process.env.TEST_EVIDENCE_DIR, { recursive: true });
            await writeFile(
              join(
                process.env.TEST_EVIDENCE_DIR,
                "rich-digest-plain-blocks.txt",
              ),
              message.Text,
            );
          }
          return;
        }
        throw new Error("Block-boundary digest was not delivered to Mailpit");
      } finally {
        if (mailId)
          await fetch("http://localhost:8025/api/v1/messages", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: [mailId] }),
          });
      }
    },
  );

  (process.env.MAILPIT_SMOKE ? it : it.skip)(
    "delivers a capped and sanitized real MIME digest with full-day counts",
    async () => {
      const title = `Boundary digest ${process.pid}`;
      const post = await addNote(
        ids.physics,
        ids.bob,
        "2026-10-15T11:00:00Z",
        title,
      );
      await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
        `Visible <script>secretScript()</script><img src="https://remote.invalid/secret.png"><a href="javascript:secretLink()">Unsafe</a> ${"A".repeat(620)}`,
        post,
      ]);
      await pool.query(
        `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at)
         SELECT id,$1,$2,'note','Additional note ' || ordinality,'Body','2026-10-15T12:00:00Z'::timestamptz
           FROM unnest($3::uuid[]) WITH ORDINALITY AS fixture(id,ordinality)`,
        [ids.physics, ids.bob, Array.from({ length: 54 }, () => uuidv7())],
      );
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-boundary",
      );
      let mailId: string | undefined;
      try {
        await live.schedule(new Date("2026-10-16T00:00:00Z"));
        await live.deliverOnce(new Date("2026-10-16T00:00:01Z"));
        const listing = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((response) => response.json())) as {
          messages: Array<{ ID: string }>;
        };
        for (const item of listing.messages) {
          const message = (await fetch(
            `http://localhost:8025/api/v1/message/${item.ID}`,
          ).then((response) => response.json())) as {
            Text: string;
            HTML: string;
          };
          if (!message.Text?.includes(title)) continue;
          mailId = item.ID;
          expect(message.Text).toContain("55 posts · 0 answers · 0 followups");
          expect(message.HTML.match(/<article\b/g)).toHaveLength(50);
          expect(message.HTML).toContain("Read more</a>");
          expect(message.HTML).toContain("View remaining activity");
          expect(message.HTML).not.toMatch(
            /secretScript|secretLink|remote\.invalid|<script|<img/,
          );
          expect(message.Text).not.toMatch(
            /secretScript|secretLink|remote\.invalid/,
          );
          if (process.env.TEST_EVIDENCE_DIR) {
            await mkdir(process.env.TEST_EVIDENCE_DIR, { recursive: true });
            await writeFile(
              join(process.env.TEST_EVIDENCE_DIR, "rich-digest-capped.html"),
              message.HTML,
            );
          }
          return;
        }
        throw new Error("Capped digest was not delivered to Mailpit");
      } finally {
        if (mailId)
          await fetch("http://localhost:8025/api/v1/messages", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: [mailId] }),
          });
      }
    },
  );

  (process.env.MAILPIT_SMOKE && process.env.S3_ENDPOINT ? it : it.skip)(
    "links unreadable images and failed equations in the real MIME digest",
    async () => {
      const title = `Fallback digest ${process.pid}`;
      const post = await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-15T12:00:00Z",
        title,
      );
      await pool.query("UPDATE posts SET body_markdown=$1 WHERE id=$2", [
        "Try $\\notacommand$ safely",
        post,
      ]);
      await pool.query(
        "INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,'unreadable.png','oversize.png','image/png',$4,$5)",
        [uuidv7(), ids.physics, post, 6 * 1024 * 1024, Buffer.alloc(32)],
      );
      const s3 = new S3Client(loadObjectStorageConfig().client);
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-fallback",
        undefined,
        s3DigestImageReader(s3, "unused-digest-fallback-bucket"),
      );
      let mailId: string | undefined;
      try {
        await live.schedule(new Date("2026-10-16T00:00:00Z"));
        await live.deliverOnce(new Date("2026-10-16T00:00:01Z"));
        const listing = (await fetch(
          "http://localhost:8025/api/v1/messages",
        ).then((response) => response.json())) as {
          messages: Array<{ ID: string }>;
        };
        for (const item of listing.messages) {
          const message = (await fetch(
            `http://localhost:8025/api/v1/message/${item.ID}`,
          ).then((response) => response.json())) as {
            Text: string;
            HTML: string;
            Inline: Array<unknown>;
          };
          if (!message.Text?.includes(title)) continue;
          mailId = item.ID;
          expect(message.HTML).toContain("View equation</a>");
          expect(message.HTML).toContain("View image: oversize.png</a>");
          expect(message.HTML).not.toContain("\\notacommand");
          expect(message.HTML).not.toContain("cid:");
          expect(message.Text).toContain("\\notacommand");
          expect(message.Inline).toHaveLength(0);
          if (process.env.TEST_EVIDENCE_DIR) {
            await mkdir(process.env.TEST_EVIDENCE_DIR, { recursive: true });
            await writeFile(
              join(process.env.TEST_EVIDENCE_DIR, "rich-digest-fallback.html"),
              message.HTML,
            );
          }
          return;
        }
        throw new Error("Fallback digest was not delivered to Mailpit");
      } finally {
        if (mailId)
          await fetch("http://localhost:8025/api/v1/messages", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: [mailId] }),
          });
        s3.destroy();
      }
    },
  );

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
      const answer = await addAnswer(
        question,
        ids.physics,
        ids.bob,
        "2026-10-15T13:00:00Z",
      );
      const followup = await addFollowup(
        question,
        ids.physics,
        ids.bob,
        "2026-10-15T14:00:00Z",
      );
      await pool.query("UPDATE answers SET body_markdown=$1 WHERE id=$2", [
        "Answer **worked**",
        answer,
      ]);
      await pool.query("UPDATE followups SET body_markdown=$1 WHERE id=$2", [
        "Followup *question*",
        followup,
      ]);
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
              HTML: string;
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
      expect(mixed?.HTML).toContain("Answer <strong>worked</strong>");
      expect(mixed?.HTML).toContain("Followup <em>question</em>");
      expect(mixed?.Text).toContain("Answer worked");
      expect(mixed?.Text).toContain("Followup question");
      expect(mixed?.Text).not.toContain("post:");
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
        expect(delivered.Text).toContain(`Late midnight note`);
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
