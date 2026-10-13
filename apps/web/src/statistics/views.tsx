import { useEffect, useRef, useState } from "react";
import {
  getStudents,
  getSummary,
  type Period,
  type StudentRow,
  type Summary,
} from "./client.js";

const periodLabels: Record<Period, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  course_to_date: "Course to date",
};
const asMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Statistics are unavailable.";
function responseTime(seconds: number | null) {
  if (seconds === null) return "0";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hr`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

export function CourseStatistics({ courseId }: { courseId: string }) {
  const [period, setPeriod] = useState<Period>("30d");
  const [cycle, setCycle] = useState(0);
  const [summary, setSummary] = useState<Summary>();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestVersion = useRef(0);
  useEffect(() => {
    const versionRef = requestVersion;
    let active = true;
    ++requestVersion.current;
    setLoading(true);
    setMoreLoading(false);
    setError(undefined);
    setSummary(undefined);
    setStudents([]);
    setCursor(null);
    void Promise.all([
      getSummary(courseId, period),
      getStudents(courseId, period),
    ])
      .then(([nextSummary, page]) => {
        if (active) {
          setSummary(nextSummary);
          setStudents(page.data);
          setCursor(page.page.nextCursor);
        }
      })
      .catch((caught) => {
        if (active) setError(asMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      ++versionRef.current;
    };
  }, [courseId, period, cycle]);
  async function loadMore() {
    if (!cursor || moreLoading) return;
    const version = requestVersion.current;
    setMoreLoading(true);
    setError(undefined);
    try {
      const page = await getStudents(courseId, period, cursor);
      if (version !== requestVersion.current) return;
      setStudents((rows) => [...rows, ...page.data]);
      setCursor(page.page.nextCursor);
    } catch (caught) {
      if (version === requestVersion.current) setError(asMessage(caught));
    } finally {
      if (version === requestVersion.current) setMoreLoading(false);
    }
  }
  const max = Math.max(
    1,
    ...(summary?.dailyActivity.map(
      (day) => day.questionsCreated + day.answersCreated + day.postsViewed,
    ) ?? []),
  );
  return (
    <section className="statistics-page" aria-labelledby="statistics-title">
      <div className="statistics-heading">
        <div>
          <h2 id="statistics-title">Course statistics</h2>
          <p>Discussion activity and current student participation</p>
        </div>
        <label>
          Period{" "}
          <select
            value={period}
            onChange={(event) => {
              ++requestVersion.current;
              setPeriod(event.target.value as Period);
            }}
          >
            {Object.entries(periodLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="statistics-note">
        Recorded views begin when course statistics is enabled. Earlier view
        counts may be incomplete.
      </p>
      {loading && <p role="status">Loading statistics…</p>}
      {error && (
        <p className="form-message error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => {
              ++requestVersion.current;
              setCycle((value) => value + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}
      {summary && (
        <>
          <div className="statistics-metrics">
            <article className="statistics-metric">
              <h3>Posts viewed</h3>
              <p className="statistics-metric-value">{summary.postsViewed}</p>
              <p>Unique views per person and post each day</p>
            </article>
            <article className="statistics-metric">
              <h3>Average response time</h3>
              <p className="statistics-metric-value">
                {responseTime(summary.averageResponseTimeSeconds)}
              </p>
              <p>Time from question to first endorsed answer</p>
            </article>
          </div>
          <section
            className="statistics-card"
            aria-labelledby="daily-activity-title"
          >
            <h3 id="daily-activity-title">Daily activity</h3>
            {summary.dailyActivity.every(
              (day) =>
                day.questionsCreated === 0 &&
                day.answersCreated === 0 &&
                day.postsViewed === 0,
            ) ? (
              <p>No activity in this period.</p>
            ) : (
              <div
                className="statistics-chart"
                role="img"
                aria-label={summary.dailyActivity
                  .map(
                    (day) =>
                      `${day.date}: ${day.questionsCreated} questions, ${day.answersCreated} answers, ${day.postsViewed} views`,
                  )
                  .join("; ")}
              >
                {summary.dailyActivity.map((day) => (
                  <div
                    className="statistics-day"
                    key={day.date}
                    title={`${day.date}: ${day.questionsCreated} questions, ${day.answersCreated} answers, ${day.postsViewed} views`}
                  >
                    <div className="statistics-bars">
                      <span
                        className="statistics-bar questions"
                        style={{
                          height: `${(day.questionsCreated / max) * 100}%`,
                        }}
                      />
                      <span
                        className="statistics-bar answers"
                        style={{
                          height: `${(day.answersCreated / max) * 100}%`,
                        }}
                      />
                      <span
                        className="statistics-bar views"
                        style={{
                          height: `${(day.postsViewed / max) * 100}%`,
                        }}
                      />
                    </div>
                    <time dateTime={day.date}>{day.date.slice(5)}</time>
                  </div>
                ))}
              </div>
            )}
            <p className="statistics-legend">
              <span className="questions" /> Questions{" "}
              <span className="answers" /> Answers <span className="views" />{" "}
              Views
            </p>
          </section>
          <section
            className="statistics-card"
            aria-labelledby="student-activity-title"
          >
            <h3 id="student-activity-title">Current students</h3>
            {students.length === 0 ? (
              <p>No students are currently enrolled.</p>
            ) : (
              <div className="statistics-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Questions</th>
                      <th scope="col">Answers contributed</th>
                      <th scope="col">Posts viewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((row) => (
                      <tr key={row.user.id}>
                        <th scope="row">{row.user.displayName}</th>
                        <td>{row.questionsCreated}</td>
                        <td>{row.answersContributed}</td>
                        <td>{row.postsViewed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cursor && (
              <button
                className="button"
                disabled={moreLoading}
                onClick={loadMore}
              >
                {moreLoading ? "Loading…" : "Load more students"}
              </button>
            )}
          </section>
        </>
      )}
    </section>
  );
}
