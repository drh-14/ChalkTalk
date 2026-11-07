import { useEffect, useState } from "react";
import { EmptyState } from "../app/EmptyState.js";
import { getPulse, type Pulse } from "./client.js";
import { busiestBlock, duration } from "./pulse-format.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// Hours read as "12 am", "3 pm"; axis labels use the compact "12a", "3p".
const hourLabel = (hour: number) =>
  `${hour % 12 || 12} ${hour < 12 ? "am" : "pm"}`;
const hourTick = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
// "Dec 15–21", or "Nov 30–Dec 6" across months.
const weekRange = (start: string) => {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(from.getTime() + 6 * 86400000);
  const month = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short" });
  return month(from) === month(to)
    ? `${month(from)} ${from.getDate()}–${to.getDate()}`
    : `${month(from)} ${from.getDate()}–${month(to)} ${to.getDate()}`;
};
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// Sequential single-hue ramp (light to dark green) for question counts.
const STEPS = 6;
const step = (value: number, max: number) =>
  value === 0 ? 0 : Math.max(1, Math.ceil((value / max) * STEPS));

const TILE_TITLES = ["Busiest time", "Peak week", "First answer", "Unanswered"];
// Bar heights for the placeholder weekly chart, as a share of its height.
const SKELETON_WEEKS = [
  30, 45, 38, 60, 52, 70, 48, 64, 80, 58, 66, 90, 54, 72, 62, 85,
];

/** The pulse layout with its real titles and placeholder values. */
function PulseSkeleton() {
  return (
    <div className="pulse pulse-skeleton">
      <p role="status" className="visually-hidden">
        Loading course pulse…
      </p>
      <div className="pulse-meta" aria-hidden="true">
        <span className="skeleton skeleton-meta" />
      </div>
      <div className="pulse-tiles" aria-hidden="true">
        {TILE_TITLES.map((title) => (
          <div className="pulse-tile" key={title}>
            <h3>{title}</h3>
            <span className="skeleton skeleton-value" />
            <span className="skeleton skeleton-line short" />
          </div>
        ))}
      </div>
      <div className="statistics-card" aria-hidden="true">
        <h3>When questions are asked</h3>
        <div className="pulse-heatmap">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span className="pulse-hour" key={hour}>
              {hour % 3 === 0 ? hourTick(hour) : ""}
            </span>
          ))}
          {DAYS.map((day) => (
            <div className="pulse-heatmap-row" key={day}>
              <span className="pulse-day">{day}</span>
              {Array.from({ length: 24 }, (_, hour) => (
                <span className="pulse-cell step-0" key={hour} />
              ))}
            </div>
          ))}
        </div>
        <p className="pulse-scale">
          Fewer
          {Array.from({ length: STEPS + 1 }, (_, index) => (
            <span key={index} className={`pulse-cell step-${index}`} />
          ))}
          More
        </p>
      </div>
      <div className="statistics-card" aria-hidden="true">
        <h3>Questions per week</h3>
        <div className="pulse-weeks">
          {SKELETON_WEEKS.map((height, index) => (
            <div className="pulse-week" key={index}>
              <div className="pulse-week-plot">
                <span
                  className="skeleton pulse-bar"
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="pulse-week-label" />
            </div>
          ))}
        </div>
      </div>
      <div className="pulse-columns" aria-hidden="true">
        {["Topics", "Top helpers"].map((title) => (
          <div className="statistics-card" key={title}>
            <h3>{title}</h3>
            <div className="pulse-skeleton-lines">
              {[0, 1, 2, 3, 4].map((row) => (
                <span className="skeleton skeleton-line" key={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CoursePulse({ courseId }: { courseId: string }) {
  const [pulse, setPulse] = useState<Pulse>();
  const [error, setError] = useState<string>();
  const [cycle, setCycle] = useState(0);
  const [tables, setTables] = useState(false);
  useEffect(() => {
    let active = true;
    setPulse(undefined);
    setError(undefined);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    getPulse(courseId, timeZone)
      .then((next) => active && setPulse(next))
      .catch(
        (caught: unknown) =>
          active &&
          setError(
            caught instanceof Error
              ? caught.message
              : "Statistics are unavailable.",
          ),
      );
    return () => {
      active = false;
    };
  }, [courseId, cycle]);

  if (error)
    return (
      <p className="form-message error" role="alert">
        {error}{" "}
        <button
          className="text-button"
          onClick={() => setCycle((value) => value + 1)}
        >
          Try again
        </button>
      </p>
    );
  if (!pulse) return <PulseSkeleton />;
  if (!pulse.questions)
    return (
      <EmptyState art="posts" title="No questions yet">
        The course pulse appears once students start asking questions.
      </EmptyState>
    );

  const block = busiestBlock(pulse.hours);
  const peak = pulse.weeks.reduce((a, b) =>
    b.questions > a.questions ? b : a,
  );
  const hourMax = Math.max(...pulse.hours.flat());
  // Label about five weeks so dates never collide, even on a phone.
  const labelEvery = Math.max(1, Math.ceil(pulse.weeks.length / 5));
  const weekMax = Math.max(...pulse.weeks.map((week) => week.questions));
  const topicMax = Math.max(1, ...pulse.topics.map((topic) => topic.questions));
  const helperMax = Math.max(
    1,
    ...pulse.helpers.map((helper) => helper.answers),
  );
  const span =
    pulse.firstQuestionAt && pulse.lastQuestionAt
      ? `${new Date(pulse.firstQuestionAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${new Date(pulse.lastQuestionAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : "";

  return (
    <div className="pulse">
      <div className="pulse-meta">
        <p className="pulse-span">
          {plural(pulse.questions, "question")} from {span}, shown in{" "}
          {pulse.timeZone.replaceAll("_", " ")} time.
        </p>

        <button
          type="button"
          className="text-button"
          aria-pressed={tables}
          onClick={() => setTables((value) => !value)}
        >
          {tables ? "Show as charts" : "Show as tables"}
        </button>
      </div>
      <div className="pulse-tiles">
        <article className="pulse-tile">
          <h3>Busiest time</h3>
          <p className="pulse-tile-value">
            {DAYS[block.day]} {hourLabel(block.start)}–
            {hourLabel((block.start + 3) % 24)}
          </p>
          <p>{plural(block.questions, "question")} in that window</p>
        </article>
        <article className="pulse-tile">
          <h3>Peak week</h3>
          <p className="pulse-tile-value">{weekRange(peak.weekStart)}</p>
          <p>{plural(peak.questions, "question")}</p>
        </article>
        <article className="pulse-tile">
          <h3>First answer</h3>
          <p className="pulse-tile-value">
            {duration(pulse.medianFirstAnswerMinutes)}
          </p>
          <p>Median wait for a first answer</p>
        </article>
        <article className="pulse-tile">
          <h3>Unanswered</h3>
          <p className="pulse-tile-value">{pulse.unanswered}</p>
          <p>of {plural(pulse.questions, "question")} still waiting</p>
        </article>
      </div>

      <section className="statistics-card" aria-labelledby="pulse-hours-title">
        <h3 id="pulse-hours-title">When questions are asked</h3>
        {tables ? (
          <div className="statistics-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {pulse.hours[0]!.map((_, hour) => (
                    <th scope="col" key={hour}>
                      {hourTick(hour)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pulse.hours.map((row, day) => (
                  <tr key={day}>
                    <th scope="row">{DAYS[day]}</th>
                    {row.map((value, hour) => (
                      <td key={hour}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div
              className="pulse-heatmap"
              role="group"
              aria-label="Questions by weekday and hour"
            >
              <span aria-hidden="true" />
              {pulse.hours[0]!.map((_, hour) => (
                <span className="pulse-hour" key={hour} aria-hidden="true">
                  {hour % 3 === 0 ? hourTick(hour) : ""}
                </span>
              ))}
              {pulse.hours.map((row, day) => (
                <div className="pulse-heatmap-row" key={day}>
                  <span className="pulse-day" aria-hidden="true">
                    {DAYS[day]}
                  </span>
                  {row.map((value, hour) => (
                    <span
                      key={hour}
                      className={`pulse-cell step-${step(value, hourMax)}`}
                      tabIndex={0}
                      aria-label={`${DAY_NAMES[day]} ${hourLabel(hour)}: ${plural(value, "question")}`}
                      data-tip={`${DAYS[day]} ${hourLabel(hour)} · ${plural(value, "question")}`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <p className="pulse-scale" aria-hidden="true">
              Fewer
              {Array.from({ length: STEPS + 1 }, (_, index) => (
                <span key={index} className={`pulse-cell step-${index}`} />
              ))}
              More
            </p>
          </>
        )}
      </section>

      <section className="statistics-card" aria-labelledby="pulse-weeks-title">
        <h3 id="pulse-weeks-title">Questions per week</h3>
        {tables ? (
          <div className="statistics-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Questions</th>
                </tr>
              </thead>
              <tbody>
                {pulse.weeks.map((week) => (
                  <tr key={week.weekStart}>
                    <th scope="row">{shortDate(week.weekStart)}</th>
                    <td>{week.questions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="pulse-weeks"
            role="group"
            aria-label="Questions per week"
          >
            {pulse.weeks.map((week, index) => (
              <div className="pulse-week" key={week.weekStart}>
                <div className="pulse-week-plot">
                  {week === peak && (
                    <span className="pulse-peak-label">{week.questions}</span>
                  )}
                  <span
                    className={`pulse-bar${week === peak ? " peak" : ""}`}
                    style={{ height: `${(week.questions / weekMax) * 100}%` }}
                    tabIndex={0}
                    aria-label={`Week of ${shortDate(week.weekStart)}: ${plural(week.questions, "question")}`}
                    data-tip={`Week of ${shortDate(week.weekStart)} · ${plural(week.questions, "question")}`}
                  />
                </div>
                <span className="pulse-week-label" aria-hidden="true">
                  {index % labelEvery === 0 ? shortDate(week.weekStart) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="pulse-columns">
        <section
          className="statistics-card"
          aria-labelledby="pulse-topics-title"
        >
          <h3 id="pulse-topics-title">Topics</h3>
          {pulse.topics.length ? (
            <div className="statistics-table-wrap">
              <table className="pulse-topics">
                <thead>
                  <tr>
                    <th scope="col">Tag</th>
                    <th scope="col">Questions</th>
                    <th scope="col">Unanswered</th>
                    <th scope="col">First answer</th>
                  </tr>
                </thead>
                <tbody>
                  {pulse.topics.map((topic) => (
                    <tr key={topic.tag}>
                      <th scope="row">#{topic.tag}</th>
                      <td>
                        <span className="pulse-inline-bar">
                          <span
                            style={{
                              width: `${(topic.questions / topicMax) * 100}%`,
                            }}
                          />
                        </span>
                        {topic.questions}
                      </td>
                      <td>{topic.unanswered}</td>
                      <td>{duration(topic.medianFirstAnswerMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No tagged questions yet.</p>
          )}
        </section>
        <section
          className="statistics-card"
          aria-labelledby="pulse-helpers-title"
        >
          <h3 id="pulse-helpers-title">Top helpers</h3>
          {pulse.helpers.length ? (
            <ol className="pulse-helpers">
              {pulse.helpers.map((helper) => (
                <li key={helper.userId}>
                  <span className="pulse-helper-name">
                    {helper.displayName}
                    <small>
                      {helper.role === "ta"
                        ? "TA"
                        : helper.role[0]!.toUpperCase() + helper.role.slice(1)}
                    </small>
                  </span>
                  <span className="pulse-inline-bar">
                    <span
                      style={{
                        width: `${(helper.answers / helperMax) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="pulse-helper-count">{helper.answers}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No named answers yet.</p>
          )}
          <p className="pulse-footnote">Anonymous answers are not counted.</p>
        </section>
      </div>
    </div>
  );
}
