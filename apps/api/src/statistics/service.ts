import type { Pool, QueryConfig, QueryResultRow } from "pg";
import { AuthError } from "../auth/errors.js";

export type StatisticsPeriod = "7d" | "30d" | "course_to_date";
type Window = { start: Date; end: Date; dates: string[] };
const invalid = () =>
  new AuthError(400, "invalid_request", "Statistics query is invalid");
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STUDENT_QUERY = `SELECT u.id,u.display_name,
        (SELECT coalesce(sum(q.question_count),0)::int FROM question_creation_daily_counts q WHERE q.course_id=$1 AND q.user_id=u.id AND q.created_on >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND q.created_on <= ($3::timestamptz AT TIME ZONE 'UTC')::date) AS questions_created,
        (SELECT count(DISTINCT e.answer_id)::int FROM answer_contribution_events e WHERE e.course_id=$1 AND e.user_id=u.id AND e.contributed_at >= $2 AND e.contributed_at <= $3) AS answers_contributed,
        (SELECT count(*)::int FROM post_view_events v WHERE v.course_id=$1 AND v.user_id=u.id AND v.viewed_at >= $2 AND v.viewed_at <= $3) AS posts_viewed
      FROM course_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.course_id=$1 AND m.role='student' AND u.deleted_at IS NULL
        AND ($4::uuid IS NULL OR u.id > $4::uuid)
      ORDER BY u.id`;
const csvCell = (value: string) => {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== value
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
};
const csv = (rows: (string | number)[][]) =>
  rows
    .map((row) =>
      row
        .map((value) =>
          typeof value === "string" ? csvCell(value) : String(value),
        )
        .join(","),
    )
    .join("\r\n") + "\r\n";

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

  private async window(
    courseId: string,
    period: StatisticsPeriod,
    courseCreatedAt: Date,
    includeDates = true,
  ): Promise<Window> {
    const end = new Date();
    const today = new Date(`${dateKey(end)}T00:00:00.000Z`);
    let firstAt = courseCreatedAt;
    if (period === "course_to_date") {
      const history = await this.query<{ first_at: Date | null }>(
        `SELECT LEAST(
          (SELECT min(created_at) FROM posts WHERE course_id=$1 AND type='question'),
          (SELECT min(created_at) FROM answers WHERE course_id=$1),
          (SELECT min(created_on::timestamp AT TIME ZONE 'UTC') FROM question_creation_daily_counts WHERE course_id=$1),
          (SELECT min(contributed_at) FROM answer_contribution_events WHERE course_id=$1),
          (SELECT min(viewed_at) FROM post_view_events WHERE course_id=$1),
          (SELECT min(endorsed_at) FROM answer_endorsement_events WHERE course_id=$1)
        ) AS first_at`,
        [courseId],
      );
      const earliest = history.rows[0]?.first_at;
      if (earliest && earliest < firstAt) firstAt = earliest;
    }
    const start =
      period === "course_to_date"
        ? new Date(`${dateKey(firstAt)}T00:00:00.000Z`)
        : new Date(today.getTime() - (period === "7d" ? 6 : 29) * 86400000);
    const dates: string[] = [];
    if (includeDates)
      for (
        let time = start.getTime();
        time <= today.getTime();
        time += 86400000
      )
        dates.push(dateKey(new Date(time)));
    return { start, end, dates };
  }

  async summary(courseId: string, userId: string, period: StatisticsPeriod) {
    const window = await this.window(
      courseId,
      period,
      await this.authorized(courseId, userId),
    );
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

  /**
   * The course's whole question history in the viewer's time zone: when
   * questions are asked, how they trend by week and topic, how fast they are
   * answered, and who answers. Anonymous answers never count toward helpers.
   */
  async pulse(courseId: string, userId: string, timeZoneInput: unknown) {
    const timeZone = timeZoneInput === undefined ? "UTC" : timeZoneInput;
    if (typeof timeZone !== "string" || timeZone.length > 64) throw invalid();
    await this.authorized(courseId, userId);
    const zone = await this.query<{ name: string }>(
      "SELECT name FROM pg_timezone_names WHERE name=$1",
      [timeZone],
    );
    if (!zone.rowCount) throw invalid();
    // Published, non-deleted questions with their first non-deleted answer.
    const questions = `WITH q AS (
        SELECT p.id,p.created_at,
          (SELECT min(a.created_at) FROM answers a
            WHERE a.post_id=p.id AND a.deleted_at IS NULL) AS first_answer_at
        FROM posts p
        WHERE p.course_id=$1 AND p.type='question' AND p.deleted_at IS NULL
          AND p.scheduled_for IS NULL
      )`;
    const median =
      "(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM q.first_answer_at-q.created_at)) FILTER (WHERE q.first_answer_at IS NOT NULL) / 60)::float8";
    const [totals, hours, weeks, topics, helpers] = await Promise.all([
      this.query<{
        questions: number;
        answered: number;
        median: number | null;
        first_at: Date | null;
        last_at: Date | null;
      }>(
        `${questions} SELECT count(*)::int AS questions,
          count(q.first_answer_at)::int AS answered,
          ${median} AS median,
          min(q.created_at) AS first_at,max(q.created_at) AS last_at FROM q`,
        [courseId],
      ),
      this.query<{ day: number; hour: number; count: number }>(
        `${questions} SELECT extract(dow FROM q.created_at AT TIME ZONE $2)::int AS day,
          extract(hour FROM q.created_at AT TIME ZONE $2)::int AS hour,
          count(*)::int AS count FROM q GROUP BY 1,2`,
        [courseId, timeZone],
      ),
      this.query<{ week: string; count: number }>(
        `${questions} SELECT (date_trunc('week',(q.created_at AT TIME ZONE $2)+interval '1 day')-interval '1 day')::date::text AS week,
          count(*)::int AS count FROM q GROUP BY 1`,
        [courseId, timeZone],
      ),
      this.query<{
        tag: string;
        questions: number;
        unanswered: number;
        median: number | null;
      }>(
        `${questions} SELECT t.name AS tag,count(*)::int AS questions,
          count(*) FILTER (WHERE q.first_answer_at IS NULL)::int AS unanswered,
          ${median} AS median
        FROM q JOIN post_tags pt ON pt.post_id=q.id JOIN tags t ON t.id=pt.tag_id
        GROUP BY t.name ORDER BY questions DESC,t.name LIMIT 10`,
        [courseId],
      ),
      this.query<{
        user_id: string;
        display_name: string;
        role: string;
        answers: number;
      }>(
        `SELECT u.id AS user_id,u.display_name,m.role,count(DISTINCT e.answer_id)::int AS answers
        FROM answer_contribution_events e
        JOIN answers a ON a.id=e.answer_id AND a.deleted_at IS NULL AND NOT a.anonymous
        JOIN course_memberships m ON m.course_id=e.course_id AND m.user_id=e.user_id
        JOIN users u ON u.id=e.user_id AND u.deleted_at IS NULL
        WHERE e.course_id=$1
        GROUP BY u.id,u.display_name,m.role
        ORDER BY answers DESC,u.display_name LIMIT 5`,
        [courseId],
      ),
    ]);
    const total = totals.rows[0]!;
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const row of hours.rows) grid[row.day]![row.hour] = row.count;
    // Every week from the first to the last question, including quiet ones.
    const counts = new Map(weeks.rows.map((row) => [row.week, row.count]));
    const keys = [...counts.keys()].sort();
    const series: { weekStart: string; questions: number }[] = [];
    if (keys.length)
      for (
        let time = Date.parse(`${keys[0]}T00:00:00Z`);
        time <= Date.parse(`${keys.at(-1)}T00:00:00Z`);
        time += 7 * 86400000
      ) {
        const weekStart = dateKey(new Date(time));
        series.push({ weekStart, questions: counts.get(weekStart) ?? 0 });
      }
    return {
      courseId,
      timeZone,
      firstQuestionAt: total.first_at?.toISOString() ?? null,
      lastQuestionAt: total.last_at?.toISOString() ?? null,
      questions: total.questions,
      answered: total.answered,
      unanswered: total.questions - total.answered,
      medianFirstAnswerMinutes: total.median,
      hours: grid,
      weeks: series,
      topics: topics.rows.map((row) => ({
        tag: row.tag,
        questions: row.questions,
        unanswered: row.unanswered,
        medianFirstAnswerMinutes: row.median,
      })),
      helpers: helpers.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        answers: row.answers,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async students(
    courseId: string,
    userId: string,
    period: StatisticsPeriod,
    limit: number,
    cursor?: string,
  ) {
    const window = await this.window(
      courseId,
      period,
      await this.authorized(courseId, userId),
      false,
    );
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
    }>(`${STUDENT_QUERY} LIMIT $5`, [
      courseId,
      window.start,
      window.end,
      afterId,
      limit + 1,
    ]);
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
  async exportDaily(
    courseId: string,
    userId: string,
    period: StatisticsPeriod,
  ) {
    const summary = await this.summary(courseId, userId, period);
    return csv([
      ["date", "questions_created", "answers_created", "posts_viewed"],
      ...summary.dailyActivity.map((day) => [
        day.date,
        day.questionsCreated,
        day.answersCreated,
        day.postsViewed,
      ]),
    ]);
  }

  async exportStudents(
    courseId: string,
    userId: string,
    period: StatisticsPeriod,
  ) {
    const window = await this.window(
      courseId,
      period,
      await this.authorized(courseId, userId),
      false,
    );
    const result = await this.query<{
      id: string;
      display_name: string;
      questions_created: number;
      answers_contributed: number;
      posts_viewed: number;
    }>(STUDENT_QUERY, [courseId, window.start, window.end, null]);
    return csv([
      [
        "user_id",
        "display_name",
        "questions_created",
        "answers_contributed",
        "posts_viewed",
      ],
      ...result.rows.map((row) => [
        row.id,
        row.display_name,
        row.questions_created,
        row.answers_contributed,
        row.posts_viewed,
      ]),
    ]);
  }
}
