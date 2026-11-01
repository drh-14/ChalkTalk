import { useEffect, useId, useState } from "react";
import { listMySessions, type CodeSession, type MySession } from "./client.js";

const names = (session: CodeSession) =>
  session.participants.map((participant) => participant.displayName).join(", ");

function JoinButton({
  session,
  onOpen,
}: {
  session: CodeSession;
  onOpen: (courseId: string, sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      className="button secondary compact"
      aria-label={`Join ${session.title}`}
      onClick={() => onOpen(session.courseId, session.id)}
    >
      Join
    </button>
  );
}

/** The viewer's active sessions across courses, for the home page. */
export function YourLiveSessions({
  viewerId,
  onOpen,
}: {
  viewerId: string;
  onOpen: (courseId: string, sessionId: string) => void;
}) {
  const headingId = useId();
  const [sessions, setSessions] = useState<MySession[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void listMySessions({ status: "active", signal: controller.signal })
      .then((page) => setSessions(page.data))
      // The home page works without this list; a failure only hides it.
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!sessions.length) return null;
  return (
    <section className="live-sessions-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Your live sessions</h2>
      <ul className="live-sessions-list">
        {sessions.map((session) => {
          const invited = session.participants.some(
            (participant) =>
              participant.userId === viewerId && participant.role === "invitee",
          );
          return (
            <li key={session.id}>
              <span className="live-sessions-dot" aria-hidden="true" />
              <div>
                <strong>{session.title}</strong>
                <span className="live-sessions-meta">
                  {session.courseName} ·{" "}
                  {invited ? "You were invited" : "You started this"} ·{" "}
                  {names(session)}
                </span>
              </div>
              <JoinButton session={session} onOpen={onOpen} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
