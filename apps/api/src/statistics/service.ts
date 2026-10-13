import type { Pool, QueryConfig, QueryResultRow } from "pg";
import { AuthError } from "../auth/errors.js";

export type StatisticsPeriod = "7d" | "30d" | "course_to_date";
type Window = { start: Date; end: Date; dates: string[] };
const invalid = () =>
  new AuthError(400, "invalid_request", "Statistics query is invalid");
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class StatisticsService {
  constructor(private readonly pool: Pool) {}

  private async query<Row extends QueryResultRow>(
    sql: string,
    values: unknown[],
  ) {
    try {
      const config: QueryConfig & { query_timeout: number } = {
        text: sql,
        values,
        query_timeout: 5000,
      };
      return await this.pool.query<Row>(config);
    } catch {
      throw new AuthError(
        503,
        "service_unavailable",
        "Statistics are temporarily unavailable",
      );
    }
  }

  static period(raw: unknown): StatisticsPeriod {
    if (raw === undefined) return "30d";
    if (raw === "7d" || raw === "30d" || raw === "course_to_date") return raw;
    throw invalid();
  }

  static limit(raw: unknown): number {
    if (raw === undefined) return 25;
    if (typeof raw !== "string" || !/^(?:[1-9]\d*)$/.test(raw)) throw invalid();
    const value = Number(raw);
    if (value < 1 || value > 100) throw invalid();
    return value;
  }

  private async authorized(courseId: string, userId: string): Promise<Date> {
    const result = await this.query<{ role: string; created_at: Date }>(
      "SELECT m.role,c.created_at FROM courses c JOIN course_memberships m ON m.course_id=c.id WHERE c.id=$1 AND m.user_id=$2",
      [courseId, userId],
    );
    const membership = result.rows[0];
    if (!membership)
      throw new AuthError(404, "not_found", "Course is not found");
    if (membership.role !== "instructor" && membership.role !== "ta")
      throw new AuthError(403, "permission_denied", "Staff role is required");
    return membership.created_at;
  }

  private window(period: StatisticsPeriod, courseCreatedAt: Date): Window {
    const end = new Date();
    const today = new Date(`${dateKey(end)}T00:00:00.000Z`);
    const start =
      period === "course_to_date"
        ? new Date(`${dateKey(courseCreatedAt)}T00:00:00.000Z`)
        : new Date(today.getTime() - (period === "7d" ? 6 : 29) * 86400000);
    const dates: string[] = [];
    for (let time = start.getTime(); time <= today.getTime(); time += 86400000)
      dates.push(dateKey(new Date(time)));
    return { start, end, dates };
  }

  async summary(courseId: string, userId: string, period: StatisticsPeriod) {
    const window = this.window(period, await this.authorized(courseId, userId));
    const [posts, answers, views, response] = await Promise.all([
      this.query<{ date: string; count: number }>(
        "SELECT (created_at AT TIME ZONE 'UTC')::date::text AS date,count(*)::int AS count FROM posts WHERE course_id=$1 AND type='question' AND created_at >= $2 AND created_at <= $3 GROUP BY 1",
        [courseId, window.start, window.end],
      ),
      this.query<{ date: string; count: number }>(
        "SELECT (created_at AT TIME ZONE 'UTC')::date::text AS date,count(*)::int AS count FROM answers WHERE course_id=$1 AND created_at >= $2 AND created_at <= $3 GROUP BY 1",
        [courseId, window.start, window.end],
      ),
      this.query<{ date: string; count: number }>(
        "SELECT viewed_on::text AS date,count(*)::int AS count FROM post_view_events WHERE course_id=$1 AND viewed_at >= $2 AND viewed_at <= $3 GROUP BY viewed_on",
        [courseId, window.start, window.end],
      ),
      this.query<{ average: number | null }>(
        `WITH first_endorsement AS (
          SELECT DISTINCT ON (p.id) p.id,p.created_at AS question_at,a.created_at AS answer_at,e.endorsed_at
          FROM posts p JOIN answers a ON a.post_id=p.id
          JOIN answer_endorsement_events e ON e.answer_id=a.id
          WHERE p.course_id=$1 AND p.type='question'
          ORDER BY p.id,e.endorsed_at,a.id
        )
        SELECT avg(GREATEST(0,extract(epoch FROM answer_at-question_at)))::float8 AS average
        FROM first_endorsement WHERE endorsed_at >= $2 AND endorsed_at <= $3`,
        [courseId, window.start, window.end],
      ),
    ]);
    const asMap = (rows: { date: string; count: number }[]) =>
      new Map(rows.map((row) => [row.date, row.count]));
    const questionsByDate = asMap(posts.rows),
      answersByDate = asMap(answers.rows),
      viewsByDate = asMap(views.rows);
    return {
      courseId,
      period,
      dailyActivity: window.dates.map((date) => ({
        date,
        questionsCreated: questionsByDate.get(date) ?? 0,
        answersCreated: answersByDate.get(date) ?? 0,
        postsViewed: viewsByDate.get(date) ?? 0,
      })),
      postsViewed: views.rows.reduce((total, row) => total + row.count, 0),
      averageResponseTimeSeconds: response.rows[0]?.average ?? null,
      generatedAt: window.end.toISOString(),
    };
  }

  async students(
    courseId: string,
    userId: string,
    period: StatisticsPeriod,
    limit: number,
    cursor?: string,
  ) {
    const window = this.window(period, await this.authorized(courseId, userId));
    let afterId: string | null = null;
    if (cursor !== undefined) {
      if (
        typeof cursor !== "string" ||
        cursor.length < 1 ||
        cursor.length > 2048
      )
        throw invalid();
      try {
        const value = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        );
        if (
          value.courseId !== courseId ||
          value.period !== period ||
          typeof value.id !== "string" ||
          !UUID_PATTERN.test(value.id)
        )
          throw invalid();
        afterId = value.id;
      } catch {
        throw invalid();
      }
    }
    const result = await this.query<{
      id: string;
      display_name: string;
      questions_created: number;
      answers_contributed: number;
      posts_viewed: number;
    }>(
      `SELECT u.id,u.display_name,
        (SELECT coalesce(sum(q.question_count),0)::int FROM question_creation_daily_counts q WHERE q.course_id=$1 AND q.user_id=u.id AND q.created_on >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND q.created_on <= ($3::timestamptz AT TIME ZONE 'UTC')::date) AS questions_created,
        (SELECT count(DISTINCT e.answer_id)::int FROM answer_contribution_events e WHERE e.course_id=$1 AND e.user_id=u.id AND e.contributed_at >= $2 AND e.contributed_at <= $3) AS answers_contributed,
        (SELECT count(*)::int FROM post_view_events v WHERE v.course_id=$1 AND v.user_id=u.id AND v.viewed_at >= $2 AND v.viewed_at <= $3) AS posts_viewed
      FROM course_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.course_id=$1 AND m.role='student' AND u.deleted_at IS NULL
        AND ($4::uuid IS NULL OR u.id > $4::uuid)
      ORDER BY u.id LIMIT $5`,
      [courseId, window.start, window.end, afterId, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      data: rows.map((row) => ({
        user: { id: row.id, displayName: row.display_name },
        questionsCreated: row.questions_created,
        answersContributed: row.answers_contributed,
        postsViewed: row.posts_viewed,
      })),
      page: {
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  courseId,
                  period,
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      },
    };
  }
}
