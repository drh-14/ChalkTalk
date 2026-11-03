/** Manual-only, bounded real-provider validation. Never imported by normal CI. */
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import { AuthService } from "../../apps/api/src/auth/service.js";
import { createEmailSender } from "../../apps/api/src/auth/email.js";
import { loadEnvironment } from "../../apps/api/src/config/environment.js";
import {
  getMigrationDirectory,
  runMigrations,
} from "../../apps/api/src/database/migrate.js";
import { JobWorker } from "../../apps/api/src/jobs/worker.js";
import { DigestService } from "../../apps/api/src/digest/service.js";
import { checkedLiveConfig, redirectTestMail } from "./resend-guard.js";

const config = checkedLiveConfig(process.env);
const runId = randomUUID().slice(0, 8);
const dbName = `chalktalk_resend_live_${runId}`;
const testDomain = "synthetic.example.edu";
const frontendBaseUrl = "https://joinchalktalk.com";
const admin = new Pool({ connectionString: config.adminDatabaseUrl, max: 1 });
const testUrl = new URL(config.adminDatabaseUrl);
testUrl.pathname = `/${dbName}`;
const pool = new Pool({ connectionString: testUrl.toString(), max: 4 });
const environment = loadEnvironment({
  ...process.env,
  AUTH_TOKEN_SECRET: "resend-live-test-secret-at-least-32-chars",
  FRONTEND_BASE_URL: frontendBaseUrl,
  FRONTEND_ORIGINS: frontendBaseUrl,
  RESEND_API_BASE_URL: "https://api.resend.com",
});
const realSender = createEmailSender(environment);
const sender = redirectTestMail(realSender, config.recipient, testDomain, 12);
const auth = new AuthService(pool, environment, sender);
const worker = new JobWorker(
  pool,
  `resend-live-${runId}`,
  sender,
  frontendBaseUrl,
);
const image = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "#345678" },
})
  .png()
  .toBuffer();
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  author: uuidv7(),
  recipient: uuidv7(),
  canonical: uuidv7(),
  source: uuidv7(),
  announcement: uuidv7(),
  discussion: uuidv7(),
  answer: uuidv7(),
  session: uuidv7(),
};
let created = false;
const results: Array<{ category: string; result: "accepted" }> = [];

async function queue(kind: string, payload: object, deduplicationKey: string) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO jobs(id,kind,payload,deduplication_key) VALUES($1,$2,$3,$4)",
    [id, kind, payload, deduplicationKey],
  );
  return id;
}

async function deliverJob(category: string, id: string) {
  const before = sender.sentCount();
  if (!(await worker.runOnce()))
    throw new Error(`${category}: no job was claimed`);
  const result = await pool.query<{
    status: string;
    frozen_email: object | null;
  }>("SELECT status,frozen_email FROM jobs WHERE id=$1", [id]);
  if (
    result.rows[0]?.status !== "succeeded" ||
    result.rows[0].frozen_email !== null ||
    sender.sentCount() !== before + 1
  )
    throw new Error(
      `${category}: provider acceptance or durable completion failed`,
    );
  results.push({ category, result: "accepted" });
}

try {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  created = true;
  await runMigrations(pool, getMigrationDirectory());

  // This reaches the real AuthService, but the test-only sender redirects before
  // the network call. The token-bearing body is never logged.
  await auth.requestVerification(`verify@${testDomain}`);
  if (sender.sentCount() !== 1)
    throw new Error("verification was not accepted");
  results.push({ category: "verification", result: "accepted" });

  await pool.query(
    "INSERT INTO organizations(id,domain,name) VALUES($1,$2,'Synthetic live test')",
    [ids.org, testDomain],
  );
  await pool.query(
    `INSERT INTO users(id,organization_id,email,display_name,password_hash)
     VALUES($1,$3,$4,'Synthetic recipient','unused'),
           ($2,$3,$5,'Synthetic author','unused')`,
    [
      ids.recipient,
      ids.author,
      ids.org,
      `recipient@${testDomain}`,
      `author@${testDomain}`,
    ],
  );
  await auth.requestPasswordReset(`recipient@${testDomain}`);
  if (!(await sender.waitForLastSend(2_000)) || sender.sentCount() !== 2)
    throw new Error("password reset was not accepted");
  results.push({ category: "password reset", result: "accepted" });

  await pool.query(
    "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Synthetic live course','RESEND01')",
    [ids.course, ids.org, ids.author],
  );
  await pool.query(
    `INSERT INTO course_memberships(course_id,user_id,role,activity_emails,announcement_emails,digest_emails)
     VALUES($1,$2,'student',true,true,true),($1,$3,'instructor',false,false,false)`,
    [ids.course, ids.recipient, ids.author],
  );
  await pool.query(
    `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown)
     VALUES($1,$4,$5,'question','Canonical question','Canonical body'),
           ($2,$4,$6,'question','Duplicate question','Duplicate body'),
           ($3,$4,$5,'question','Activity question','Activity body')`,
    [
      ids.canonical,
      ids.source,
      ids.discussion,
      ids.course,
      ids.author,
      ids.recipient,
    ],
  );

  await pool.query(
    "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
    [ids.source, ids.canonical],
  );
  const sourceVersion = (
    await pool.query<{ version: string }>(
      "SELECT version FROM posts WHERE id=$1",
      [ids.source],
    )
  ).rows[0]!.version;
  await deliverJob(
    "duplicate/merge",
    await queue(
      "send_question_duplicate_email",
      {
        sourcePostId: ids.source,
        canonicalPostId: ids.canonical,
        staffUserId: ids.author,
        staffRole: "instructor",
      },
      `${ids.source}:${sourceVersion}`,
    ),
  );

  await pool.query(
    "INSERT INTO collaboration_sessions(id,course_id,title,created_by_user_id) VALUES($1,$2,'Synthetic live session',$3)",
    [ids.session, ids.course, ids.author],
  );
  await pool.query(
    `INSERT INTO collaboration_participants(collaboration_session_id,course_id,user_id,invited_by_user_id)
     VALUES($1,$2,$3,$4)`,
    [ids.session, ids.course, ids.recipient, ids.author],
  );
  const invitedAt = (
    await pool.query<{ ms: string }>(
      `SELECT floor(extract(epoch FROM created_at)*1000)::bigint AS ms
     FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2`,
      [ids.session, ids.recipient],
    )
  ).rows[0]!.ms;
  await deliverJob(
    "collaboration invitation",
    await queue(
      "send_collaboration_invitation_email",
      {
        sessionId: ids.session,
        inviteeUserId: ids.recipient,
        inviterUserId: ids.author,
      },
      `${ids.session}:${ids.recipient}:${invitedAt}`,
    ),
  );

  await pool.query(
    `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,announcement)
     VALUES($1,$2,$3,'note','Synthetic announcement','This is synthetic content.',true)`,
    [ids.announcement, ids.course, ids.author],
  );
  await deliverJob(
    "announcement",
    await queue(
      "send_announcement_email",
      { postId: ids.announcement, userId: ids.recipient },
      `${ids.announcement}:${ids.recipient}`,
    ),
  );

  const scheduledPost = uuidv7();
  const scheduledFor = new Date(Date.now() - 10_000).toISOString();
  await pool.query(
    `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,announcement,scheduled_for)
     VALUES($1,$2,$3,'note','Scheduled synthetic announcement','Scheduled synthetic body',true,$4)`,
    [scheduledPost, ids.course, ids.author, scheduledFor],
  );
  const publication = await queue(
    "publish_scheduled_announcement",
    { postId: scheduledPost, scheduledFor },
    `${scheduledPost}:${scheduledFor}`,
  );
  if (!(await worker.runOnce()))
    throw new Error("scheduled announcement was not published");
  const publicationStatus = (
    await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id=$1",
      [publication],
    )
  ).rows[0]?.status;
  const scheduledEmail = (
    await pool.query<{ id: string }>(
      "SELECT id FROM jobs WHERE kind='send_announcement_email' AND deduplication_key=$1",
      [`${scheduledPost}:${ids.recipient}`],
    )
  ).rows[0]?.id;
  if (publicationStatus !== "succeeded" || !scheduledEmail)
    throw new Error("scheduled announcement did not queue its email");
  await deliverJob("scheduled announcement", scheduledEmail);

  await pool.query(
    "INSERT INTO post_follows(post_id,course_id,user_id,following) VALUES($1,$2,$3,true)",
    [ids.discussion, ids.course, ids.recipient],
  );
  await pool.query(
    `INSERT INTO answers(id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor)
     VALUES($1,$2,$3,'student','Synthetic answer line one\nline two',$4,'student')`,
    [ids.answer, ids.course, ids.discussion, ids.author],
  );
  const notification = (
    await pool.query<{ id: string }>(
      `INSERT INTO notifications(id,user_id,course_id,post_id,kind,actor_user_id)
     VALUES($1,$2,$3,$4,'answer_created',$5) RETURNING id`,
      [uuidv7(), ids.recipient, ids.course, ids.discussion, ids.author],
    )
  ).rows[0]!.id;
  await deliverJob(
    "activity/mention",
    await queue(
      "send_notification_email",
      {
        notificationId: notification,
        responseKind: "answer",
        responseId: ids.answer,
      },
      notification,
    ),
  );
  const mention = (
    await pool.query<{ id: string }>(
      `INSERT INTO notifications(id,user_id,course_id,post_id,kind,actor_user_id)
     VALUES($1,$2,$3,$4,'mentioned',$5) RETURNING id`,
      [uuidv7(), ids.recipient, ids.course, ids.discussion, ids.author],
    )
  ).rows[0]!.id;
  await deliverJob(
    "mention",
    await queue(
      "send_notification_email",
      { notificationId: mention },
      mention,
    ),
  );

  const yesterday = new Date(Date.now() - 86_400_000);
  const day = yesterday.toISOString().slice(0, 10);
  const at = `${day}T12:00:00.000Z`;
  const digestPost = uuidv7();
  const digestAnswer = uuidv7();
  const digestFollowup = uuidv7();
  const attachmentId = uuidv7();
  await pool.query(
    `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at)
     VALUES($1,$2,$3,'question','Digest question','Synthetic digest body',$4)`,
    [digestPost, ids.course, ids.author, at],
  );
  await pool.query(
    `INSERT INTO answers(id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor,created_at)
     VALUES($1,$2,$3,'student','Synthetic digest answer',$4,'student',$5)`,
    [digestAnswer, ids.course, digestPost, ids.author, at],
  );
  await pool.query(
    `INSERT INTO followups(id,course_id,post_id,author_user_id,body_markdown,created_at)
     VALUES($1,$2,$3,$4,'Synthetic digest followup',$5)`,
    [digestFollowup, ids.course, digestPost, ids.author, at],
  );
  await pool.query(
    `INSERT INTO content_attachments(id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256)
     VALUES($1,$2,$3,$4,'tiny.png','image/png',$5,$6)`,
    [
      attachmentId,
      ids.course,
      digestPost,
      `synthetic/${runId}/tiny.png`,
      image.length,
      createHash("sha256").update(image).digest(),
    ],
  );
  await pool.query(
    "UPDATE digest_schedule_state SET last_scanned_date=$1::date - 1",
    [day],
  );
  const digest = new DigestService(
    pool,
    sender,
    frontendBaseUrl,
    `resend-live-digest-${runId}`,
    undefined,
    async () => image,
  );
  if ((await digest.schedule()) !== 1)
    throw new Error("digest schedule did not create one synthetic outbox row");
  const beforeDigest = sender.sentCount();
  if (!(await digest.deliverOnce())) throw new Error("digest was not claimed");
  const outbox = (
    await pool.query<{ status: string; frozen_email: object | null }>(
      "SELECT status,frozen_email FROM digest_outbox WHERE recipient_user_id=$1",
      [ids.recipient],
    )
  ).rows[0];
  if (
    outbox?.status !== "sent" ||
    outbox.frozen_email !== null ||
    sender.sentCount() !== beforeDigest + 1 ||
    !sender.lastMessage()?.html?.includes("cid:") ||
    !sender.lastMessage()?.attachments?.length
  )
    throw new Error("digest acceptance or durable completion failed");
  results.push({
    category: "daily digest with inline image",
    result: "accepted",
  });

  console.log(
    JSON.stringify({
      runId,
      provider: "resend",
      results,
      sends: sender.sentCount(),
      inboxReceipt: "not_asserted",
    }),
  );
} finally {
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin.end();
}
