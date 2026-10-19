import { useEffect, useId, useState, type FormEvent } from "react";
import {
  SESSION_LANGUAGES,
  createSession,
  listSessions,
  type CodeSession,
  type SessionLanguage,
} from "./client.js";

const languageLabel = (language: SessionLanguage) =>
  SESSION_LANGUAGES.find((option) => option.value === language)?.label ??
  language;

function SessionRow({
  session,
  onOpen,
}: {
  session: CodeSession;
  onOpen: (id: string) => void;
}) {
  return (
    <li className="sessions-row">
      <div>
        <strong>{session.title}</strong>
        <span className="sessions-row-meta">
          {languageLabel(session.language)} ·{" "}
          {session.participants
            .map((participant) => participant.displayName)
            .join(", ")}
        </span>
      </div>
      <button
        type="button"
        className="button secondary compact"
        aria-label={`${session.status === "active" ? "Join" : "View"} ${session.title}`}
        onClick={() => onOpen(session.id)}
      >
        {session.status === "active" ? "Join" : "View"}
      </button>
    </li>
  );
}

/** Live code sessions on a post that the viewer may open, and a way to start one. */
export function SessionsPanel({
  courseId,
  postId,
  courseStatus,
  csrfToken,
  onOpen,
}: {
  courseId: string;
  postId: string;
  courseStatus?: string;
  csrfToken: string;
  onOpen: (sessionId: string) => void;
}) {
  const headingId = useId();
  const [sessions, setSessions] = useState<CodeSession[]>();
  const [error, setError] = useState<string>();
  const [showEnded, setShowEnded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [language, setLanguage] = useState<SessionLanguage>("python");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setSessions(undefined);
    setError(undefined);
    void listSessions(courseId, { postId, signal: controller.signal })
      .then((page) => setSessions(page.data))
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Sessions are unavailable.",
          );
      });
    return () => controller.abort();
  }, [courseId, postId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setStartError(undefined);
    try {
      const created = await createSession(
        courseId,
        { postId, language, title },
        csrfToken,
      );
      onOpen(created.data.id);
    } catch (caught) {
      setStartError(
        caught instanceof Error
          ? caught.message
          : "The session could not start.",
      );
      setPending(false);
    }
  }

  const active =
    sessions?.filter((session) => session.status === "active") ?? [];
  const ended = sessions?.filter((session) => session.status === "ended") ?? [];

  return (
    <section className="sessions-panel" aria-labelledby={headingId}>
      <div className="sessions-header">
        <h3 id={headingId}>Live code sessions</h3>
        {courseStatus === "active" && !starting && (
          <button
            type="button"
            className="button secondary compact"
            onClick={() => setStarting(true)}
          >
            Start live code session
          </button>
        )}
      </div>
      {starting && (
        <form
          className="sessions-start"
          onSubmit={start}
          aria-label="Start a live code session"
        >
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
          <label>
            Title (optional)
            <input
              value={title}
              maxLength={120}
              placeholder="Uses the post title if left blank"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <p className="sessions-warning">
            Only you, course staff, and people you invite can open this session.
            Participants see your name, even if you posted anonymously.
          </p>
          {startError && (
            <p className="form-message error" role="alert">
              {startError}
            </p>
          )}
          <div className="sessions-start-actions">
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? "Starting…" : "Start session"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => setStarting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className="form-message error" role="alert">
          {error}
        </p>
      ) : !sessions ? (
        <p role="status">Loading sessions…</p>
      ) : active.length ? (
        <ul className="sessions-list">
          {active.map((session) => (
            <SessionRow key={session.id} session={session} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="sessions-empty">
          No active live code sessions on this post.
        </p>
      )}
      {ended.length > 0 && (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={showEnded}
            onClick={() => setShowEnded((value) => !value)}
          >
            {showEnded ? "Hide" : "Show"} ended sessions ({ended.length})
          </button>
          {showEnded && (
            <ul className="sessions-list ended">
              {ended.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
