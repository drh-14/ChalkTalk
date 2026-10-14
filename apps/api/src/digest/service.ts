import type { Pool, PoolClient } from "pg";
import type { EmailSender } from "../auth/service.js";

type OutboxRow = {
  id: string;
  recipient_user_id: string;
  course_id: string;
  activity_date: string;
  attempts: number;
};

type ActivityRow = {
  kind: "question" | "answer" | "followup";
  post_id: string;
  title: string;
  created_at: Date;
};

// All three events are creation events. Joining the active parent here also
// prevents a delayed email from linking to a deleted or merged question.
const activity = `
  SELECT p.course_id,p.id AS post_id,p.author_user_id,
         p.created_at,'question'::text AS kind,p.title
    FROM posts p
   WHERE p.type='question' AND p.deleted_at IS NULL
     AND p.duplicate_status <> 'confirmed'
  UNION ALL
  SELECT a.course_id,a.post_id,a.created_by_user_id,
         a.created_at,'answer'::text,p.title
    FROM answers a JOIN posts p ON p.id=a.post_id AND p.course_id=a.course_id
   WHERE a.deleted_at IS NULL AND p.type='question'
     AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
  UNION ALL
  SELECT f.course_id,f.post_id,f.author_user_id,
         f.created_at,'followup'::text,p.title
    FROM followups f JOIN posts p ON p.id=f.post_id AND p.course_id=f.course_id
   WHERE f.deleted_at IS NULL AND p.type='question'
     AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
`;

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compact(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export class DigestService {
  constructor(
    private readonly pool: Pool,
    private readonly sender: EmailSender,
    private readonly frontendBaseUrl: string,
    private readonly workerId = `api-${process.pid}`,
  ) {}

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Discover every complete eligible UTC date, including dates missed during downtime. */
  async schedule(now = new Date()): Promise<number> {
    const today = utcDate(now);
    const yesterday = utcDate(
      new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000),
    );
    return this.transaction(async (client) => {
      const cursor = await client.query<{ last_scanned_date: string }>(
        "SELECT last_scanned_date::text FROM digest_schedule_state WHERE singleton=true FOR UPDATE",
      );
      const lastScannedDate = cursor.rows[0]?.last_scanned_date;
      if (!lastScannedDate)
        throw new Error("Daily digest schedule state is missing");
      if (lastScannedDate >= yesterday) return 0;
      const result = await client.query(
        `WITH activity AS (${activity}), eligible AS (
         SELECT DISTINCT u.id AS recipient_user_id, a.course_id,
                (a.created_at AT TIME ZONE 'UTC')::date AS activity_date
           FROM activity a
           JOIN courses c ON c.id=a.course_id AND c.status='active'
           JOIN course_memberships m ON m.course_id=a.course_id
           JOIN users u ON u.id=m.user_id
          WHERE u.deleted_at IS NULL AND u.daily_digest_enabled
            AND a.author_user_id <> u.id
            AND (a.created_at AT TIME ZONE 'UTC')::date >= u.daily_digest_enabled_date
            AND (a.created_at AT TIME ZONE 'UTC')::date > $2::date
            AND (a.created_at AT TIME ZONE 'UTC')::date < $1::date
       )
       INSERT INTO digest_outbox(recipient_user_id,course_id,activity_date,available_at)
       SELECT recipient_user_id,course_id,activity_date,
              (activity_date + 1)::timestamp AT TIME ZONE 'UTC'
         FROM eligible
       ON CONFLICT (recipient_user_id,course_id,activity_date)
       DO UPDATE SET status='queued',locked_by=NULL,locked_until=NULL,
                     available_at=EXCLUDED.available_at,updated_at=now()
         WHERE digest_outbox.status='canceled'`,
        [today, lastScannedDate],
      );
      await client.query(
        "UPDATE digest_schedule_state SET last_scanned_date=$1 WHERE singleton=true",
        [yesterday],
      );
      return result.rowCount ?? 0;
    });
  }

  private async claim(now: Date): Promise<OutboxRow | undefined> {
    return this.transaction(async (client) => {
      const result = await client.query<OutboxRow>(
        `SELECT id,recipient_user_id,course_id,activity_date::text,attempts
           FROM digest_outbox
          WHERE (status='queued' AND available_at <= $1)
             OR (status='running' AND locked_until <= $1)
          ORDER BY activity_date,created_at,id
          FOR UPDATE SKIP LOCKED LIMIT 1`,
        [now],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const claimed = await client.query<{ attempts: number }>(
        `UPDATE digest_outbox SET status='running',attempts=attempts+1,
                locked_by=$2,locked_until=$1::timestamptz+interval '2 minutes',updated_at=$1
          WHERE id=$3 RETURNING attempts`,
        [now, this.workerId, row.id],
      );
      return { ...row, attempts: claimed.rows[0]!.attempts };
    });
  }

  private async cancel(row: OutboxRow, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE digest_outbox SET status='canceled',locked_by=NULL,locked_until=NULL,updated_at=$4
        WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3`,
      [row.id, this.workerId, row.attempts, now],
    );
  }

  private async deliver(row: OutboxRow, now: Date): Promise<void> {
    const recipient = await this.pool.query<{
      email: string;
      course_name: string;
    }>(
      `SELECT u.email,c.name AS course_name FROM users u
         JOIN course_memberships m ON m.user_id=u.id AND m.course_id=$2
         JOIN courses c ON c.id=m.course_id
        WHERE u.id=$1 AND u.deleted_at IS NULL AND u.daily_digest_enabled
          AND u.daily_digest_enabled_date <= $3::date AND c.status='active'`,
      [row.recipient_user_id, row.course_id, row.activity_date],
    );
    if (!recipient.rows[0]) {
      await this.cancel(row, now);
      return;
    }
    const items = await this.pool.query<ActivityRow>(
      `WITH activity AS (${activity})
       SELECT kind,post_id,title,created_at FROM activity
        WHERE course_id=$1 AND author_user_id <> $2
          AND created_at >= ($3::date::timestamp AT TIME ZONE 'UTC')
          AND created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
        ORDER BY created_at,post_id,kind`,
      [row.course_id, row.recipient_user_id, row.activity_date],
    );
    if (items.rows.length === 0) {
      await this.cancel(row, now);
      return;
    }
    const courseName = compact(recipient.rows[0].course_name);
    const counts = {
      question: items.rows.filter((item) => item.kind === "question").length,
      answer: items.rows.filter((item) => item.kind === "answer").length,
      followup: items.rows.filter((item) => item.kind === "followup").length,
    };
    const lines = [
      `${courseName} activity for ${row.activity_date} UTC`,
      "",
      [
        countLabel(counts.question, "question"),
        countLabel(counts.answer, "answer"),
        countLabel(counts.followup, "followup"),
      ].join(" · "),
      "",
      ...items.rows.map(
        (item) =>
          `${item.kind}: ${compact(item.title)}\n${this.frontendBaseUrl}/courses/${row.course_id}/posts/${item.post_id}`,
      ),
    ];
    await this.sender.send({
      to: recipient.rows[0].email,
      subject: `ChalkTalk daily digest: ${courseName} — ${row.activity_date}`,
      text: lines.join("\n"),
    });
    await this.pool.query(
      `UPDATE digest_outbox SET status='sent',sent_at=$4,locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=$4
        WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3`,
      [row.id, this.workerId, row.attempts, now],
    );
  }

  /** Returns false when no due record was available; failures remain retryable. */
  async deliverOnce(now = new Date()): Promise<boolean> {
    const row = await this.claim(now);
    if (!row) return false;
    try {
      await this.deliver(row, now);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SMTP failure";
      await this.pool.query(
        `UPDATE digest_outbox SET status='queued',available_at=$4::timestamptz + make_interval(secs => LEAST(3600, (2 ^ LEAST($3,10))::integer)),
                locked_by=NULL,locked_until=NULL,last_error=$5,updated_at=$4
          WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3`,
        [row.id, this.workerId, row.attempts, now, message.slice(0, 4000)],
      );
    }
    return true;
  }
}
