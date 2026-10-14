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
    await pool.query(
      "UPDATE users SET daily_digest_enabled=false,daily_digest_enabled_date=NULL,version=1 WHERE id=$1",
      [ids.alice],
    );
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

  it("requires a current ETag, valid boolean, session, origin and CSRF for opt-in", async () => {
    const app = createApp({ environment, authService: auth });
    const path = "/api/v1/users/me";
    const unsafe = () =>
      request(app)
        .patch(path)
        .set("Cookie", cookie)
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", csrf);
    expect((await unsafe().send({ dailyDigestEnabled: true })).status).toBe(
      428,
    );
    expect(
      (
        await unsafe()
          .set("If-Match", '"v1"')
          .send({ dailyDigestEnabled: "yes" })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch(path)
          .set("If-Match", '"v1"')
          .send({ dailyDigestEnabled: true })
      ).status,
    ).toBe(403);
    const enabled = await unsafe()
      .set("If-Match", '"v1"')
      .send({ dailyDigestEnabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.dailyDigestEnabled).toBe(true);
    expect(enabled.headers.etag).toBe('"v2"');
    const preference = await pool.query(
      "SELECT daily_digest_enabled_date::text AS enabled_date,(now() AT TIME ZONE 'UTC')::date::text AS today FROM users WHERE id=$1",
      [ids.alice],
    );
    expect(preference.rows[0].enabled_date).toBe(preference.rows[0].today);
    expect(
      (
        await unsafe()
          .set("If-Match", '"v1"')
          .send({ dailyDigestEnabled: false })
      ).status,
    ).toBe(412);
  });

  it("sends distinct course emails for visible external question, answer, and followup creation", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
    expect(await digest.deliverOnce(new Date("2026-10-15T01:00:00Z"))).toBe(
      true,
    );
    expect(await digest.deliverOnce(new Date("2026-10-15T01:00:00Z"))).toBe(
      true,
    );
    expect(sender.messages).toHaveLength(2);
    expect(sender.messages.map((message) => message.subject).sort()).toEqual([
      "ChalkTalk daily digest: Chemistry — 2026-10-14",
      "ChalkTalk daily digest: Physics — 2026-10-14",
    ]);
    expect(
      sender.messages.find((message) => message.subject.includes("Physics"))
        ?.text,
    ).toContain("1 answer");
    expect(
      sender.messages.find((message) => message.subject.includes("Physics"))
        ?.text,
    ).toContain("1 followup");
    expect(
      sender.messages.every(
        (message) => !message.text.includes("Own question"),
      ),
    ).toBe(true);
  });

  it("catches up missed dates but never backfills before opt-in", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-13T12:00:00Z",
      "Before opt-in",
    );
    await addQuestion(
      ids.physics,
      ids.bob,
      "2026-10-14T12:00:00Z",
      "First eligible day",
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

  it("serializes concurrent schedulers using the durable date cursor", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
      expect(sender.messages[0]?.text).toContain("Late commit");
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });

  it("does not revive a canceled historical digest after access returns", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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

  it("does not block note creation on the digest scheduling cursor", async () => {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR UPDATE",
    );
    const posts = new PostService(pool);
    const note = posts.create(ids.physics, ids.bob, {
      type: "note",
      title: "Not digest activity",
      bodyMarkdown: "Body",
    });
    try {
      const completed = await Promise.race([
        note.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      expect(completed).toBe(true);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await note;
    }
  });

  it("records SMTP completion and bases retries on completion time", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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

  it("holds consent and access through an in-flight SMTP handoff", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
      pool.query(
        "UPDATE users SET daily_digest_enabled=false,daily_digest_enabled_date=NULL WHERE id=$1",
        [ids.alice],
      ),
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
      expect(completed).toEqual([false, false, false, false]);
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

  it("completes opt-out while a claimed delivery waits for the user row", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    await pool.query(`CREATE FUNCTION digest_pause_opt_out() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(31415, 27182); RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER digest_pause_opt_out AFTER UPDATE OF daily_digest_enabled ON users
      FOR EACH ROW WHEN (OLD.daily_digest_enabled AND NOT NEW.daily_digest_enabled)
      EXECUTE FUNCTION digest_pause_opt_out()`);
    const blocker = await pool.connect();
    let optOut: Promise<{ status: number }> | undefined;
    let delivery: Promise<boolean> | undefined;
    try {
      await blocker.query("SELECT pg_advisory_lock(31415, 27182)");
      const app = createApp({ environment, authService: auth });
      optOut = request(app)
        .patch("/api/v1/users/me")
        .set("Cookie", cookie)
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", csrf)
        .set("If-Match", '"v1"')
        .send({ dailyDigestEnabled: false })
        .then((response) => response);
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM pg_locks
            WHERE locktype='advisory' AND classid=31415 AND objid=27182 AND NOT granted`,
        );
        if (waiting.rows[0]?.count) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const waiting = await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM pg_locks
          WHERE locktype='advisory' AND classid=31415 AND objid=27182 AND NOT granted`,
      );
      expect(waiting.rows[0]?.count).toBe(1);
      delivery = digest.deliverOnce(new Date("2026-10-15T00:00:01Z"));
      for (let attempt = 0; attempt < 100; attempt++) {
        const claimed = await pool.query<{ status: string }>(
          "SELECT status FROM digest_outbox WHERE recipient_user_id=$1",
          [ids.alice],
        );
        if (claimed.rows[0]?.status === "running") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
      ).toBe("running");
      await blocker.query("SELECT pg_advisory_unlock(31415, 27182)");
      const results = await Promise.allSettled([optOut, delivery]);
      expect(results[0]).toMatchObject({
        status: "fulfilled",
        value: { status: 200 },
      });
      expect(results[1]).toMatchObject({ status: "fulfilled", value: true });
      expect(sender.messages).toHaveLength(0);
      expect(
        (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
      ).toBe("canceled");
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(31415, 27182)");
      blocker.release();
      if (optOut || delivery) await Promise.allSettled([optOut, delivery]);
      await pool.query("DROP TRIGGER digest_pause_opt_out ON users");
      await pool.query("DROP FUNCTION digest_pause_opt_out()");
    }
  }, 15_000);

  it("does not reclaim a slow active SMTP attempt after its lease expires", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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

  it("rechecks opt-out, access and content before SMTP and retries failures", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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

  it("cancels pending mail on opt-out and skips archived courses", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
    await addQuestion(ids.physics, ids.bob, "2026-10-14T12:00:00Z", "Question");
    await digest.schedule(new Date("2026-10-15T00:00:00Z"));
    const app = createApp({ environment, authService: auth });
    const disabled = await request(app)
      .patch("/api/v1/users/me")
      .set("Cookie", cookie)
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", csrf)
      .set("If-Match", '"v1"')
      .send({ dailyDigestEnabled: false });
    expect(disabled.status).toBe(200);
    expect(
      (await pool.query("SELECT status FROM digest_outbox")).rows[0].status,
    ).toBe("canceled");
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
      false,
    );
    expect(sender.messages).toHaveLength(0);
  });

  it("waits until UTC midnight and uses half-open UTC dates", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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

  it("omits notes, confirmed duplicates, hidden answers and deleted followup tombstones", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES ($1,$2,$3,'note','A note','Body','2026-10-14T06:00:00Z')",
      [uuidv7(), ids.physics, ids.bob],
    );
    expect(await digest.schedule(new Date("2026-10-15T00:00:00Z"))).toBe(0);
    expect(await digest.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
      false,
    );
  });

  it("rechecks course archive and membership before send", async () => {
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
    await pool.query(
      "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
      [ids.alice],
    );
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
    "captures a real digest in Mailpit and emits no empty email",
    async () => {
      const before = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number };
      await pool.query(
        "UPDATE users SET daily_digest_enabled=true,daily_digest_enabled_date='2026-10-14' WHERE id=$1",
        [ids.alice],
      );
      await addQuestion(
        ids.physics,
        ids.bob,
        "2026-10-14T12:00:00Z",
        "Mailpit smoke question",
      );
      const live = new DigestService(
        pool,
        createEmailSender(environment),
        environment.frontendBaseUrl,
        "mailpit-smoke",
      );
      await live.schedule(new Date("2026-10-15T00:00:00Z"));
      expect(await live.deliverOnce(new Date("2026-10-15T00:00:01Z"))).toBe(
        true,
      );
      const after = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number; messages: Array<{ Subject: string }> };
      expect(after.total).toBe(before.total + 1);
      expect(
        after.messages.some(
          (message) =>
            message.Subject === "ChalkTalk daily digest: Physics — 2026-10-14",
        ),
      ).toBe(true);
      await pool.query(
        "UPDATE users SET daily_digest_enabled=false,daily_digest_enabled_date=NULL WHERE id=$1",
        [ids.alice],
      );
      await live.schedule(new Date("2026-10-16T00:00:00Z"));
      expect(await live.deliverOnce(new Date("2026-10-16T00:00:01Z"))).toBe(
        false,
      );
      const empty = (await fetch("http://localhost:8025/api/v1/messages").then(
        (response) => response.json(),
      )) as { total: number };
      expect(empty.total).toBe(after.total);
    },
  );
});
