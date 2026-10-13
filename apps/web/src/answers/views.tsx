import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../auth/client.js";
import { MarkdownEditorField } from "../posts/MarkdownEditorField.js";
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
  onCancel: () => void;
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
        <button className="text-button" type="button" onClick={onCancel}>
          Cancel
        </button>
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
  const [editing, setEditing] = useState(false);
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
          ? "Endorse this answer? It cannot be edited afterward."
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
        Edited by {names}
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
      {editing ? (
        <TextComposer
          label="Answer"
          initial={answer.bodyMarkdown}
          submitLabel="Save answer"
          onCancel={() => setEditing(false)}
          onRefresh={async () => onReplace(await getAnswer(answer.id))}
          onSubmit={async (body) => {
            onReplace(await editAnswer(answer, body, props.csrfToken));
            setEditing(false);
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
            onClick={() => setEditing(true)}
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
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setAnswers(undefined);
    setError("");
    listAnswers(props.postId, controller.signal)
      .then((listed) =>
        setAnswers((current) =>
          current
            ? [
                ...listed,
                ...current.filter(
                  (item) => !listed.some((entry) => entry.id === item.id),
                ),
              ]
            : listed,
        ),
      )
      .catch((caught) => {
        if (!controller.signal.aborted) setError(message(caught));
      });
    return () => controller.abort();
  }, [props.postId, cycle]);
  return (
    <section className="answer-sections" aria-label="Answers">
      <div className="response-heading">
        <h2>Answers</h2>
        {canWrite(props) && !composing && (
          <button
            className="button secondary"
            type="button"
            onClick={() => setComposing(true)}
          >
            Write an answer
          </button>
        )}
      </div>
      {error && (
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
      )}
      {!answers && !error && <p role="status">Loading answers…</p>}
      {answers?.length === 0 && <p className="answer-empty">No answers yet.</p>}
      {answers?.map((answer) => (
        <AnswerCard
          key={answer.id}
          answer={answer}
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
      ))}
      {composing && (
        <TextComposer
          label="Answer"
          submitLabel="Post answer"
          anonymousAllowed
          onCancel={() => setComposing(false)}
          onSubmit={async (body, anonymous, key) => {
            const created = await createAnswer(
              props.postId,
              { bodyMarkdown: body, anonymous },
              props.csrfToken,
              key,
            );
            setAnswers((items) => [...(items ?? []), created]);
            setComposing(false);
          }}
        />
      )}
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
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [children, setChildren] = useState<FollowupPage>();
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
      setChildren(await listFollowups(item.postId, item.id));
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
      ) : editing ? (
        <TextComposer
          label="Followup"
          initial={item.bodyMarkdown ?? ""}
          submitLabel="Save followup"
          onCancel={() => setEditing(false)}
          onRefresh={async () => onReplace(await getFollowup(item.id))}
          onSubmit={async (body) => {
            onReplace(await editFollowup(item, body, props.csrfToken));
            setEditing(false);
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
                onClick={() => setEditing(true)}
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
            setChildren(
              (page) =>
                page && {
                  data: [...page.data, created].sort(followupOrder),
                  meta: {
                    total: page.meta.total + 1,
                    nextCursor: page.meta.nextCursor,
                  },
                },
            );
            onReplace({ ...item, replyCount: item.replyCount + 1 });
            setReplying(false);
          }}
        />
      )}
      {item.replyCount > 0 && !children && (
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
          {children.data.map((child) => (
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
                      data: hasReplies
                        ? page.data.map((entry) =>
                            entry.id === id
                              ? {
                                  ...entry,
                                  bodyMarkdown: null,
                                  deleted: true,
                                  version: entry.version + 1,
                                }
                              : entry,
                          )
                        : page.data.filter((entry) => entry.id !== id),
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
        <span>{page?.meta.total ?? 0} Followup Discussions</span>
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
      {page?.data.map((item) => (
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
                  data: hasReplies
                    ? current.data.map((entry) =>
                        entry.id === id
                          ? {
                              ...entry,
                              bodyMarkdown: null,
                              deleted: true,
                              version: entry.version + 1,
                            }
                          : entry,
                      )
                    : current.data.filter((entry) => entry.id !== id),
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
    <div className="question-responses">
      <AnswerSections {...props} />
      <FollowupSections {...props} />
    </div>
  );
}
