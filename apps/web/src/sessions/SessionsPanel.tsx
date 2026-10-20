import { useEffect, useId, useState, type FormEvent } from "react";
import {
  SESSION_LANGUAGES,
  createSession,
  languageFromTags,
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

/** Links to the viewer's active session on a post, for the post header. */
export function ActiveSessionLink({
  sessions,
  onOpen,
}: {
  sessions: readonly CodeSession[] | undefined;
  onOpen: (sessionId: string) => void;
}) {
  const active = sessions?.find((session) => session.status === "active");
  if (!active) return null;
  return (
    <button
      type="button"
      className="active-session-link"
      onClick={() => onOpen(active.id)}
    >
      <span className="active-session-dot" aria-hidden="true" />
      Live session active
      <span className="visually-hidden">: join {active.title}</span>
    </button>
  );
}

/** Live sessions on a post that the viewer may open, and a way to start one. */
export function SessionsPanel({
  courseId,
  postId,
  tags = [],
  courseStatus,
  csrfToken,
  onOpen,
  onLoaded,
}: {
  courseId: string;
  postId: string;
  tags?: readonly string[];
  courseStatus?: string;
  csrfToken: string;
  onOpen: (sessionId: string) => void;
  /** Receives the sessions this panel lists, so the post header can link to one. */
  onLoaded?: (sessions: CodeSession[]) => void;
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
      .then((page) => {
        setSessions(page.data);
        onLoaded?.(page.data);
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
    // onLoaded reports this post's sessions; a new callback alone is no reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <h3 id={headingId}>Live sessions</h3>
        {courseStatus === "active" && !starting && (
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              setLanguage(languageFromTags(tags));
              setStarting(true);
            }}
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
        <p className="sessions-empty">No active live sessions on this post.</p>
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
