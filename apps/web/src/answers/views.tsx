import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../auth/client.js";
import { MarkdownEditorField } from "../posts/MarkdownEditorField.js";
import { LiveBodyEditor } from "./LiveBodyEditor.js";
import { PostBody } from "../posts/PostBody.js";
import { formatPostTime } from "../posts/time.js";
import {
  createAnswer,
  deleteAnswer,
  endorseAnswer,
  editAnswer,
  listAnswers,
  voteAnswer,
  createFollowup,
  deleteFollowup,
  editFollowup,
  getAnswer,
  getFollowup,
  listFollowups,
  voteFollowup,
  type Answer,
  type Followup,
  type FollowupPage,
} from "./client.js";

type Role = "student" | "ta" | "instructor";
type Props = {
  postId: string;
  role?: Role;
  courseStatus?: "active" | "archived" | "deleting";
  csrfToken: string;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const canWrite = (props: Props) =>
  !!props.role && props.courseStatus === "active";
const staff = (role?: Role) => role === "ta" || role === "instructor";
const labels = {
  student: "Students' answer",
  staff: "Instructors' answer",
} as const;
const followupOrder = (a: Followup, b: Followup) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function TextComposer({
  label,
  initial = "",
  anonymousAllowed = false,
  submitLabel,
  onSubmit,
  onCancel,
  onRefresh,
}: {
  label: string;
  initial?: string;
  anonymousAllowed?: boolean;
  submitLabel: string;
  onSubmit: (body: string, anonymous: boolean, key: string) => Promise<void>;
  onCancel?: () => void;
  onRefresh?: () => Promise<void>;
}) {
  const [body, setBody] = useState(initial);
  const [anonymous, setAnonymous] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!body.trim() || body.length > 100000) {
      setError("Write 1 to 100,000 characters before posting.");
      return;
    }
    const payload = JSON.stringify({ body, anonymous });
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      await onSubmit(body, anonymous, attempt.current.key);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "version_conflict"
          ? "This text changed. Refresh to see the latest version; your draft is still here."
          : message(caught),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="response-composer"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <MarkdownEditorField
        label={label}
        value={body}
        onChange={setBody}
        disableImages
      />
      {anonymousAllowed && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          Post anonymously
        </label>
      )}
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
      {error.includes("Refresh") && onRefresh && (
        <button
          type="button"
          className="text-button"
          onClick={() =>
            void onRefresh()
              .then(() =>
                setError(
                  "Latest version loaded. Review your draft before saving.",
                ),
              )
              .catch((caught) => setError(message(caught)))
          }
        >
          Refresh content
        </button>
      )}
      <div className="response-actions">
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button className="text-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function VoteButton({
  kind,
  count,
  voted,
  disabled,
  onClick,
}: {
  kind: "answer" | "followup";
  count: number;
  voted: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="response-vote"
      type="button"
      aria-label={`${voted ? "Remove upvote from" : "Upvote"} ${kind}`}
      aria-pressed={voted}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">👍</span> <span>{count}</span>
    </button>
  );
}

function AnswerCard({
  answer,
  props,
  onReplace,
  onRemove,
}: {
  answer: Answer;
  props: Props;
  onReplace: (answer: Answer) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<"live" | "rest" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const names =
    answer.contributors === null
      ? "Anonymous"
      : answer.contributors.length
        ? answer.contributors.map((person) => person.displayName).join(", ")
        : "Deleted user";
  const time = formatPostTime(answer.updatedAt);
  async function act(action: "vote" | "endorse" | "delete") {
    if (pending) return;
    if (
      action !== "vote" &&
      !window.confirm(
        action === "endorse"
          ? "Endorse this answer? A later text edit will clear this endorsement."
          : "Delete this answer? This cannot be undone.",
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      if (action === "vote")
        onReplace(
          await voteAnswer(answer, !answer.viewerUpvoted, props.csrfToken),
        );
      if (action === "endorse")
        onReplace(await endorseAnswer(answer, props.csrfToken));
      if (action === "delete") {
        await deleteAnswer(answer, props.csrfToken);
        onRemove(answer.id);
      }
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="answer-card"
      role="region"
      aria-label={`Answer by ${names}`}
    >
      <div className="answer-card-header">
        <h3>Answer</h3>
        {answer.endorsedAt && <span className="answer-endorsed">Endorsed</span>}
      </div>
      <p className="response-byline">
        Contributors: {names}
        {time && (
          <>
            {" "}
            ·{" "}
            <time dateTime={time.dateTime} title={time.title}>
              {time.label}
            </time>
          </>
        )}
      </p>
      {editing === "live" ? (
        <LiveBodyEditor
          kind="answer"
          id={answer.id}
          csrfToken={props.csrfToken}
          onDone={async () => {
            onReplace(await getAnswer(answer.id));
            setEditing(null);
          }}
          onFallback={() => setEditing("rest")}
        />
      ) : editing === "rest" ? (
        <TextComposer
          label="Answer"
          initial={answer.bodyMarkdown}
          submitLabel="Save answer"
          onCancel={() => setEditing(null)}
          onRefresh={async () => onReplace(await getAnswer(answer.id))}
          onSubmit={async (body) => {
            onReplace(await editAnswer(answer, body, props.csrfToken));
            setEditing(null);
          }}
        />
      ) : (
        <div className="post-markdown response-text">
          <PostBody bodyMarkdown={answer.bodyMarkdown} disableImages />
        </div>
      )}
      <div className="response-actions">
        <VoteButton
          kind="answer"
          count={answer.upvoteCount}
          voted={answer.viewerUpvoted}
          disabled={!canWrite(props) || pending}
          onClick={() => void act("vote")}
        />
        {canWrite(props) && answer.canEdit && !editing && (
          <button
            className="text-button"
            type="button"
            onClick={() => setEditing("live")}
          >
            Edit answer
          </button>
        )}
        {canWrite(props) &&
          staff(props.role) &&
          !answer.endorsedAt &&
          !editing && (
            <>
              <button
                className="text-button"
                type="button"
                disabled={pending}
                onClick={() => void act("endorse")}
              >
                Endorse answer
              </button>
              <button
                className="text-button danger"
                type="button"
                disabled={pending}
                onClick={() => void act("delete")}
              >
                Delete answer
              </button>
            </>
          )}
      </div>
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
    </section>
  );
}

export function AnswerSections(props: Props) {
  const [answers, setAnswers] = useState<Answer[]>();
  const [error, setError] = useState("");
  const [cycle, setCycle] = useState(0);
  const [racedKind, setRacedKind] = useState<Answer["kind"]>();
  const [composingKind, setComposingKind] = useState<Answer["kind"]>();
  useEffect(() => {
    const controller = new AbortController();
    setAnswers(undefined);
    setError("");
    listAnswers(props.postId, controller.signal)
      .then(setAnswers)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(message(caught));
      });
    return () => controller.abort();
  }, [props.postId, cycle]);
  const canCreate = (kind: Answer["kind"]) =>
    canWrite(props) &&
    (kind === "student" ? props.role === "student" : staff(props.role));
  return (
    <section className="answer-sections" aria-label="Answers">
      {(["student", "staff"] as const).map((kind) => {
        const found = answers?.find((item) => item.kind === kind);
        return (
          <section
            className={`shared-answer-slot shared-answer-${kind}`}
            role="region"
            aria-label={labels[kind]}
            key={kind}
          >
            <h3>
              <span className="answer-kind-icon" aria-hidden="true">
                {kind === "student" ? "S" : "i"}
              </span>
              {labels[kind]}
            </h3>
            {!answers ? (
              error ? (
                <p role="status">
                  Answers are unavailable. {error}{" "}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setCycle((n) => n + 1)}
                  >
                    Try again
                  </button>
                </p>
              ) : (
                <p role="status">Loading answers…</p>
              )
            ) : found ? (
              <AnswerCard
                answer={found}
                props={props}
                onReplace={(next) =>
                  setAnswers((items) =>
                    items?.map((item) => (item.id === next.id ? next : item)),
                  )
                }
                onRemove={(id) =>
                  setAnswers((items) => items?.filter((item) => item.id !== id))
                }
              />
            ) : !canCreate(kind) ? (
              <p className="answer-empty">
                No {labels[kind].toLowerCase()} yet.
              </p>
            ) : null}
            {answers && canCreate(kind) && !found && composingKind !== kind && (
              <button
                className="answer-start-prompt"
                type="button"
                aria-label={`Start ${labels[kind].toLowerCase()}`}
                onClick={() => setComposingKind(kind)}
              >
                Click to start the{" "}
                {kind === "student" ? "students'" : "instructors'"} answer
              </button>
            )}
            {answers &&
              canCreate(kind) &&
              composingKind === kind &&
              (!found || racedKind === kind) && (
                <TextComposer
                  key={kind}
                  label="Your answer"
                  submitLabel="Post answer"
                  anonymousAllowed
                  onCancel={() => {
                    setRacedKind(undefined);
                    setComposingKind(undefined);
                  }}
                  onSubmit={async (body, anonymous, key) => {
                    try {
                      const created = await createAnswer(
                        props.postId,
                        { bodyMarkdown: body, anonymous },
                        props.csrfToken,
                        key,
                      );
                      setAnswers((items) => [
                        ...(items ?? []).filter((item) => item.kind !== kind),
                        created,
                      ]);
                      setRacedKind(undefined);
                      setComposingKind(undefined);
                    } catch (caught) {
                      if (
                        caught instanceof ApiError &&
                        caught.code === "answer_kind_exists"
                      ) {
                        setRacedKind(kind);
                        setAnswers(await listAnswers(props.postId));
                      }
                      throw caught;
                    }
                  }}
                />
              )}
          </section>
        );
      })}
    </section>
  );
}

function FollowupItem({
  item,
  props,
  onReplace,
  onDelete,
}: {
  item: Followup;
  props: Props;
  onReplace: (next: Followup) => void;
  onDelete: (id: string, hasReplies: boolean) => void;
}) {
  const [editing, setEditing] = useState<"live" | "rest" | null>(null);
  const [replying, setReplying] = useState(false);
  const [children, setChildren] = useState<FollowupPage>();
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const name = item.deleted
    ? "Deleted followup"
    : (item.author?.displayName ??
      (item.anonymous ? "Anonymous" : "Deleted user"));
  async function act(action: "vote" | "delete") {
    if (pending) return;
    if (action === "delete" && !window.confirm("Delete this followup?")) return;
    setPending(true);
    setError("");
    try {
      if (action === "vote")
        onReplace(
          await voteFollowup(item, !item.viewerUpvoted, props.csrfToken),
        );
      else {
        await deleteFollowup(item, props.csrfToken);
        onDelete(item.id, item.replyCount > 0);
      }
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  async function showReplies() {
    try {
      const result = await listFollowups(item.postId, item.id);
      setChildren((current) => ({
        data: [
          ...result.data.filter(
            (entry) => !current?.data.some((local) => local.id === entry.id),
          ),
          ...(current?.data ?? []),
        ].sort(followupOrder),
        meta: result.meta,
      }));
      setRepliesLoaded(true);
      setError("");
    } catch (caught) {
      setError(message(caught));
    }
  }
  return (
    <article className="followup-item" aria-label={`Followup by ${name}`}>
      <p className="response-byline">{name}</p>
      {item.deleted ? (
        <p className="response-tombstone">This followup was deleted.</p>
      ) : editing === "live" ? (
        <LiveBodyEditor
          kind="followup"
          id={item.id}
          csrfToken={props.csrfToken}
          onDone={async () => {
            onReplace(await getFollowup(item.id));
            setEditing(null);
          }}
          onFallback={() => setEditing("rest")}
        />
      ) : editing === "rest" ? (
        <TextComposer
          label="Followup"
          initial={item.bodyMarkdown ?? ""}
          submitLabel="Save followup"
          onCancel={() => setEditing(null)}
          onRefresh={async () => onReplace(await getFollowup(item.id))}
          onSubmit={async (body) => {
            onReplace(await editFollowup(item, body, props.csrfToken));
            setEditing(null);
          }}
        />
      ) : (
        <div className="post-markdown response-text">
          <PostBody bodyMarkdown={item.bodyMarkdown ?? ""} disableImages />
        </div>
      )}
      {!item.deleted && (
        <div className="response-actions">
          <VoteButton
            kind="followup"
            count={item.upvoteCount}
            voted={item.viewerUpvoted}
            disabled={!canWrite(props) || pending}
            onClick={() => void act("vote")}
          />
          {canWrite(props) && (
            <button
              className="text-button"
              type="button"
              onClick={() => setReplying(true)}
            >
              Reply
            </button>
          )}
          {canWrite(props) && item.canEdit && !editing && (
            <>
              <button
                className="text-button"
                type="button"
                onClick={() => setEditing("live")}
              >
                Edit followup
              </button>
              <button
                className="text-button danger"
                type="button"
                disabled={pending}
                onClick={() => void act("delete")}
              >
                Delete followup
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
      {replying && (
        <TextComposer
          label="Followup"
          submitLabel="Post reply"
          anonymousAllowed
          onCancel={() => setReplying(false)}
          onSubmit={async (body, anonymous, key) => {
            const created = await createFollowup(
              item.postId,
              { bodyMarkdown: body, anonymous },
              props.csrfToken,
              key,
              item.id,
            );
            setChildren((page) => ({
              data: [...(page?.data ?? []), created].sort(followupOrder),
              meta: {
                total: (page?.meta.total ?? 0) + 1,
                nextCursor: page?.meta.nextCursor ?? null,
              },
            }));
            onReplace({ ...item, replyCount: item.replyCount + 1 });
            setReplying(false);
          }}
        />
      )}
      {item.replyCount > 0 && !repliesLoaded && (
        <button
          className="text-button"
          type="button"
          onClick={() => void showReplies()}
        >
          Show {item.replyCount} replies
        </button>
      )}
      {children && (
        <div className="followup-replies" aria-label="Replies">
          {children.data
            .filter((child) => !child.deleted || child.replyCount > 0)
            .map((child) => (
              <FollowupItem
                key={child.id}
                item={child}
                props={props}
                onReplace={(next) =>
                  setChildren(
                    (page) =>
                      page && {
                        ...page,
                        data: page.data.map((entry) =>
                          entry.id === next.id ? next : entry,
                        ),
                      },
                  )
                }
                onDelete={(id, hasReplies) => {
                  setChildren(
                    (page) =>
                      page && {
                        ...page,
                        data: page.data.map((entry) =>
                          entry.id === id
                            ? {
                                ...entry,
                                bodyMarkdown: null,
                                deleted: true,
                                version: entry.version + 1,
                              }
                            : entry,
                        ),
                        meta: {
                          ...page.meta,
                          total: page.meta.total - (hasReplies ? 0 : 1),
                        },
                      },
                  );
                  if (!hasReplies) {
                    if (item.deleted && item.replyCount === 1)
                      onDelete(item.id, false);
                    else
                      onReplace({
                        ...item,
                        replyCount: Math.max(0, item.replyCount - 1),
                      });
                  }
                }}
              />
            ))}
          {children.meta.nextCursor && (
            <button
              className="text-button"
              type="button"
              onClick={() =>
                void listFollowups(
                  item.postId,
                  item.id,
                  children.meta.nextCursor ?? undefined,
                )
                  .then((next) =>
                    setChildren(
                      (current) =>
                        current && {
                          data: [
                            ...current.data,
                            ...next.data.filter(
                              (entry) =>
                                !current.data.some(
                                  (loaded) => loaded.id === entry.id,
                                ),
                            ),
                          ].sort(followupOrder),
                          meta: next.meta,
                        },
                    ),
                  )
                  .catch((caught) => setError(message(caught)))
              }
            >
              Load more replies
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function FollowupSections(props: Props) {
  const [page, setPage] = useState<FollowupPage>();
  const [error, setError] = useState("");
  const [cycle, setCycle] = useState(0);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError("");
    listFollowups(props.postId)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((caught) => {
        if (active) setError(message(caught));
      });
    return () => {
      active = false;
    };
  }, [props.postId, cycle]);
  return (
    <section className="followup-sections" aria-label="Followup discussions">
      <h2>
        <span aria-hidden="true">◯ </span>
        <span>{page ? `${page.meta.total} ` : ""}Followup Discussions</span>
      </h2>
      {error && (
        <p role="status">
          Followups are unavailable. {error}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => setCycle((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      {!page && !error && <p role="status">Loading followups…</p>}
      {page?.data
        .filter((item) => !item.deleted || item.replyCount > 0)
        .map((item) => (
          <FollowupItem
            key={item.id}
            item={item}
            props={props}
            onReplace={(next) =>
              setPage(
                (current) =>
                  current && {
                    ...current,
                    data: current.data.map((entry) =>
                      entry.id === next.id ? next : entry,
                    ),
                  },
              )
            }
            onDelete={(id, hasReplies) =>
              setPage(
                (current) =>
                  current && {
                    ...current,
                    data: current.data.map((entry) =>
                      entry.id === id
                        ? {
                            ...entry,
                            bodyMarkdown: null,
                            deleted: true,
                            version: entry.version + 1,
                          }
                        : entry,
                    ),
                    meta: {
                      ...current.meta,
                      total: current.meta.total - (hasReplies ? 0 : 1),
                    },
                  },
              )
            }
          />
        ))}
      {page?.meta.nextCursor && (
        <button
          className="text-button"
          type="button"
          onClick={() =>
            void listFollowups(
              props.postId,
              undefined,
              page.meta.nextCursor ?? undefined,
            )
              .then((next) =>
                setPage(
                  (current) =>
                    current && {
                      data: [
                        ...current.data,
                        ...next.data.filter(
                          (entry) =>
                            !current.data.some(
                              (loaded) => loaded.id === entry.id,
                            ),
                        ),
                      ].sort(followupOrder),
                      meta: next.meta,
                    },
                ),
              )
              .catch((caught) => setError(message(caught)))
          }
        >
          Load more discussions
        </button>
      )}
      {canWrite(props) && !composing && (
        <button
          className="followup-prompt"
          type="button"
          onClick={() => setComposing(true)}
        >
          Compose a new followup discussion
        </button>
      )}
      {composing && (
        <TextComposer
          label="Followup"
          submitLabel="Post followup"
          anonymousAllowed
          onCancel={() => setComposing(false)}
          onSubmit={async (body, anonymous, key) => {
            const created = await createFollowup(
              props.postId,
              { bodyMarkdown: body, anonymous },
              props.csrfToken,
              key,
            );
            if (page)
              setPage(
                (current) =>
                  current && {
                    data: [...current.data, created].sort(followupOrder),
                    meta: {
                      total: current.meta.total + 1,
                      nextCursor: current.meta.nextCursor,
                    },
                  },
              );
            else setCycle((n) => n + 1);
            setComposing(false);
          }}
        />
      )}
    </section>
  );
}

export function QuestionResponses(props: Props) {
  return (
    <div className="question-responses" key={props.postId}>
      <AnswerSections {...props} />
      <FollowupSections {...props} />
    </div>
  );
}
