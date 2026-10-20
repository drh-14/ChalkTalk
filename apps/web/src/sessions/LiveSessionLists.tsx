import { useEffect, useId, useState } from "react";
import {
  listMySessions,
  listSessions,
  type CodeSession,
  type MySession,
} from "./client.js";

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

/**
 * Active sessions in a course: a student's own, or every session for staff,
 * so TAs and instructors can see what is running during office hours.
 */
export function CourseLiveSessions({
  courseId,
  staff,
  onOpen,
}: {
  courseId: string;
  staff: boolean;
  onOpen: (courseId: string, sessionId: string) => void;
}) {
  const headingId = useId();
  const [sessions, setSessions] = useState<CodeSession[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setSessions([]);
    void listSessions(courseId, {
      status: "active",
      signal: controller.signal,
    })
      .then((page) => setSessions(page.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, [courseId]);

  if (!sessions.length) return null;
  return (
    <section className="course-live-sessions" aria-labelledby={headingId}>
      <div className="course-live-sessions-heading">
        <h2 id={headingId}>
          <span className="live-sessions-dot" aria-hidden="true" />
          Live sessions
        </h2>
        <span className="live-sessions-meta">
          {staff
            ? `${sessions.length} running in this course`
            : sessions.length === 1
              ? "1 active"
              : `${sessions.length} active`}
        </span>
      </div>
      <ul className="live-sessions-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <div>
              <strong>{session.title}</strong>
              <span className="live-sessions-meta">{names(session)}</span>
            </div>
            <JoinButton session={session} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
