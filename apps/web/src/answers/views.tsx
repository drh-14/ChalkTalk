import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ApiError } from "../auth/client.js";
import { formatPostTime } from "../posts/time.js";
import {
  createAnswer,
  deleteAnswer,
  endorseAnswer,
  listAnswers,
  type Answer,
} from "./client.js";

type Role = "student" | "ta" | "instructor";
type Kind = Answer["kind"];
const LABELS: Record<Kind, string> = {
  student: "Students' answer",
  staff: "Instructors' answer",
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function Byline({ answer }: { answer: Answer }) {
  const time = formatPostTime(answer.createdAt);
  const names =
    answer.contributors === null
      ? "Anonymous"
      : answer.contributors.length
        ? answer.contributors.map((person) => person.displayName).join(", ")
        : "Deleted user";
  return (
    <p className="post-author">
      {names}
      {time && (
        <>
          {" "}
          <time
            className="post-time"
            dateTime={time.dateTime}
            title={time.title}
          >
            {time.label}
          </time>
        </>
      )}
    </p>
  );
}

function AnswerComposer({
  kind,
  postId,
  csrfToken,
  onCreated,
  onTaken,
}: {
  kind: Kind;
  postId: string;
  csrfToken: string;
  onCreated: (answer: Answer) => void;
  onTaken: () => void;
}) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string }>(undefined);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!body.trim()) return setError("Write an answer before posting.");
    if (body.length > 100000)
      return setError("Answers can be at most 100,000 characters.");
    const input = { bodyMarkdown: body, anonymous };
    const payload = JSON.stringify(input);
    // Reuse the idempotency key only when retrying the same draft.
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      onCreated(
        await createAnswer(postId, input, csrfToken, attempt.current.key),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "answer_kind_exists")
        return onTaken();
      setError(message(caught));
      setPending(false);
    }
  }
  return (
    <form
      className="answer-composer"
      aria-label={`Write the ${LABELS[kind].toLowerCase()}`}
      onSubmit={submit}
      noValidate
    >
      <label>
        Your answer
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(event) => setAnonymous(event.target.checked)}
        />
        Answer anonymously
      </label>
      <p className="answer-note">
        This answer can't be edited after you post it yet.
      </p>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post answer"}
      </button>
    </form>
  );
}

export function AnswerSections({
  postId,
  role,
  courseStatus,
  csrfToken,
}: {
  postId: string;
  role?: Role;
  courseStatus?: "active" | "archived" | "deleting";
  csrfToken: string;
}) {
  const [answers, setAnswers] = useState<Answer[]>();
  const [loadError, setLoadError] = useState("");
  const [cycle, setCycle] = useState(0);
  const [actionError, setActionError] = useState<Partial<Record<Kind, string>>>(
    {},
  );
  const [busy, setBusy] = useState<Kind>();
  useEffect(() => {
    const controller = new AbortController();
    setAnswers(undefined);
    setLoadError("");
    listAnswers(postId, controller.signal)
      .then(setAnswers)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(`Answers are unavailable. ${message(caught)}`);
      });
    return () => controller.abort();
  }, [postId, cycle]);
  const active = courseStatus === "active";
  const staff = role === "ta" || role === "instructor";
  const replace = (kind: Kind, next?: Answer) =>
    setAnswers((current) => [
      ...(current ?? []).filter((item) => item.kind !== kind),
      ...(next ? [next] : []),
    ]);
  async function act(answer: Answer, action: "endorse" | "delete") {
    const label = LABELS[answer.kind].toLowerCase();
    const question =
      action === "endorse"
        ? `Endorse the ${label}? It can't be changed afterward.`
        : `Delete the ${label}? This can't be undone.`;
    if (busy || !window.confirm(question)) return;
    setBusy(answer.kind);
    setActionError((current) => ({ ...current, [answer.kind]: undefined }));
    try {
      if (action === "endorse")
        replace(answer.kind, await endorseAnswer(answer, csrfToken));
      else {
        await deleteAnswer(answer, csrfToken);
        replace(answer.kind);
      }
    } catch (caught) {
      setActionError((current) => ({
        ...current,
        [answer.kind]: message(caught),
      }));
    } finally {
      setBusy(undefined);
    }
  }
  if (loadError)
    return (
      <div className="answer-sections">
        <p role="alert">{loadError}</p>
        <button
          type="button"
          className="text-button"
          onClick={() => setCycle((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  if (!answers)
    return (
      <div className="answer-sections">
        <p role="status">Loading answers…</p>
      </div>
    );
  return (
    <div className="answer-sections">
      {(["student", "staff"] as const).map((kind) => {
        const answer = answers.find((item) => item.kind === kind);
        const label = LABELS[kind];
        const mine = active && (kind === "staff" ? staff : role === "student");
        return (
          <section key={kind} className="answer" aria-label={label}>
            <h3>{label}</h3>
            {answer ? (
              <>
                {answer.endorsedAt && (
                  <p className="answer-endorsed">Endorsed</p>
                )}
                <div className="post-markdown">
                  <ReactMarkdown>{answer.bodyMarkdown}</ReactMarkdown>
                </div>
                <Byline answer={answer} />
                {staff && active && !answer.endorsedAt && (
                  <div className="answer-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy === kind}
                      onClick={() => void act(answer, "endorse")}
                    >
                      Endorse {label.toLowerCase()}
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy === kind}
                      onClick={() => void act(answer, "delete")}
                    >
                      Delete {label.toLowerCase()}
                    </button>
                  </div>
                )}
                {actionError[kind] && (
                  <p className="form-message error" role="alert">
                    {actionError[kind]}
                  </p>
                )}
              </>
            ) : mine ? (
              <AnswerComposer
                kind={kind}
                postId={postId}
                csrfToken={csrfToken}
                onCreated={(created) => replace(kind, created)}
                onTaken={() => setCycle((value) => value + 1)}
              />
            ) : (
              <p className="answer-empty">No {label.toLowerCase()} yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
