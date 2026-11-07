import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError } from "../auth/client.js";
import {
  SESSION_LANGUAGES,
  createSession,
  listSessions,
  type CodeSession,
  type SessionLanguage,
} from "./client.js";
import { EmptyState } from "../app/EmptyState.js";

const languageLabel = (language: SessionLanguage) =>
  SESSION_LANGUAGES.find((option) => option.value === language)?.label ??
  language;

export function CourseCollaboration({
  courseId,
  active,
  csrfToken,
  onOpen,
}: {
  courseId: string;
  active: boolean;
  csrfToken: string;
  onOpen: (sessionId: string) => void;
}) {
  const headingId = useId();
  const [sessions, setSessions] = useState<CodeSession[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<SessionLanguage>("plaintext");
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setSessions(undefined);
    setError(undefined);
    void listSessions(courseId, { signal: controller.signal })
      .then((page) => {
        setSessions(page.data);
        setCursor(page.page.nextCursor);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Sessions are unavailable.",
          );
      });
    return () => controller.abort();
  }, [courseId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !title.trim()) return;
    setPending(true);
    setStartError(undefined);
    try {
      const created = await createSession(
        courseId,
        { title, language },
        csrfToken,
      );
      onOpen(created.data.id);
    } catch (caught) {
      setStartError(
        caught instanceof ApiError && caught.code === "rate_limited"
          ? "You have started a lot of sessions recently. Try again in a little while."
          : caught instanceof Error
            ? caught.message
            : "The session could not start.",
      );
    } finally {
      setPending(false);
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await listSessions(courseId, { cursor });
      setSessions((current) => [...(current ?? []), ...page.data]);
      setCursor(page.page.nextCursor);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "More sessions could not load.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section
      className="sessions-panel course-collaboration"
      aria-labelledby={headingId}
    >
      <div className="sessions-header">
        <div>
          <h2 id={headingId}>Collaboration</h2>
          <p>Live code and whiteboard sessions shared with you.</p>
        </div>
        {active && !starting && (
          <button
            type="button"
            className="button primary compact"
            onClick={() => setStarting(true)}
          >
            Start live session
          </button>
        )}
      </div>
      {starting && (
        <form
          className="sessions-start"
          onSubmit={start}
          aria-label="Start a live session"
        >
          <label>
            Title
            <input
              value={title}
              required
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Language
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as SessionLanguage)
              }
            >
              {SESSION_LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="sessions-warning">
            Only you and people you invite can open this session. Participants
            see your name.
          </p>
          {startError && (
            <p className="form-message error" role="alert">
              {startError}
            </p>
          )}
          <div className="sessions-start-actions">
            <button
              type="submit"
              className="button primary"
              disabled={pending || !title.trim()}
            >
              {pending ? "Starting…" : "Start session"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={() => setStarting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {!sessions ? (
        !error && (
          <p role="status" className="loading-line">
            Loading sessions…
          </p>
        )
      ) : sessions.length ? (
        <ul className="sessions-list">
          {sessions.map((session) => (
            <li className="sessions-row" key={session.id}>
              <div>
                <strong>{session.title}</strong>
                <span className="sessions-row-meta">
                  {languageLabel(session.language)} ·{" "}
                  {session.participants
                    .map((participant) => participant.displayName)
                    .join(", ")}
                </span>
                <span className="sessions-row-meta">
                  {session.status === "ended" ? "Ended" : "Live"}
                </span>
              </div>
              <button
                type="button"
                className="button secondary compact"
                aria-label={`${session.status === "active" ? "Open" : "View"} ${session.title}`}
                onClick={() => onOpen(session.id)}
              >
                {session.status === "active" ? "Open" : "View"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState art="sessions" title="No collaboration sessions yet">
          Start a live session to write code and sketch on a shared whiteboard
          together in real time.
        </EmptyState>
      )}
      {cursor && (
        <button
          type="button"
          className="button secondary"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more sessions"}
        </button>
      )}
    </section>
  );
}
