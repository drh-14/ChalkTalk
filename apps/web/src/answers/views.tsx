import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../auth/client.js";
import { MarkdownEditorField } from "../posts/MarkdownEditorField.js";
import { PostBody } from "../posts/PostBody.js";
import {
  AttachmentManager,
  AttachmentSelection,
} from "../attachments/views.js";
import { useAttachmentQueue } from "../attachments/queue.js";
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
  setFollowupResolved,
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
  allowAnonymousPosting?: boolean;
  allowFollowupResolution?: boolean;
  discussionLocked?: boolean;
  csrfToken: string;
  /**
   * Called after the viewer answers, edits an answer, posts, deletes, or
   * resolves a followup, or replies.
   */
  onActivity?: () => void;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const canWrite = (props: Props) =>
  !!props.role && props.courseStatus === "active";
const canParticipate = (props: Props) =>
  canWrite(props) && !props.discussionLocked;
const staff = (role?: Role) => role === "ta" || role === "instructor";
const labels = {
  student: "Students' answer",
  staff: "Instructors' answer",
} as const;
const followupOrder = (a: Followup, b: Followup) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function applyAnswerProjection(
  current: Answer,
  next: Answer,
  keepActivity: boolean,
) {
  if (next.version < current.version) return current;
  return {
    ...next,
    upvoteCount: keepActivity ? current.upvoteCount : next.upvoteCount,
    viewerUpvoted: keepActivity ? current.viewerUpvoted : next.viewerUpvoted,
  };
}

function applyFollowupProjection(
  current: Followup,
  next: Followup,
  keepActivity: boolean,
) {
  if (next.version < current.version) return current;
  return {
    ...next,
    upvoteCount: keepActivity ? current.upvoteCount : next.upvoteCount,
    viewerUpvoted: keepActivity ? current.viewerUpvoted : next.viewerUpvoted,
    replyCount: keepActivity ? current.replyCount : next.replyCount,
  };
}

function useAuthoritativeRefresh<T>(
  id: string,
  read: (id: string) => Promise<T>,
  replace: (next: T) => void,
  report: (error: string) => void,
) {
  const localGeneration = useRef(0);
  const readGeneration = useRef(0);
  const pending = useRef(0);
  const reading = useRef(false);
  const requested = useRef(false);
  const active = useRef(true);
  const replaceRef = useRef(replace);
  const reportRef = useRef(report);
  replaceRef.current = replace;
  reportRef.current = report;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function drain() {
    if (
      !active.current ||
      !requested.current ||
      reading.current ||
      pending.current
    )
      return;
    requested.current = false;
    reading.current = true;
    const readAt = readGeneration.current;
    const localAt = localGeneration.current;
    void read(id)
      .then((latest) => {
        if (!active.current) return;
        if (
          readAt !== readGeneration.current ||
          localAt !== localGeneration.current ||
          pending.current
        ) {
          requested.current = true;
          return;
        }
        replaceRef.current(latest);
      })
      .catch((caught) => {
        if (!active.current) return;
        if (
          readAt !== readGeneration.current ||
          localAt !== localGeneration.current ||
          pending.current
        )
          requested.current = true;
        else reportRef.current(message(caught));
      })
      .finally(() => {
        reading.current = false;
        drain();
      });
  }
  return {
    generation: () => localGeneration.current,
    overlaps: (started: number, ownOperation = false) =>
      started !== localGeneration.current ||
      pending.current > (ownOperation ? 1 : 0),
    begin: () => {
      pending.current++;
      return localGeneration.current;
    },
    finish: (changed: boolean) => {
      pending.current--;
      if (changed) localGeneration.current++;
      drain();
    },
    refresh: () => {
      requested.current = true;
      readGeneration.current++;
      drain();
    },
  };
}

function TextComposer({
  label,
  initial = "",
  anonymousAllowed = false,
  submitLabel,
  onSubmit,
  onCancel,
  onRefresh,
  attachmentKind,
  onComplete,
  csrfToken,
  onAttachmentUploaded,
}: {
  label: string;
  initial?: string;
  anonymousAllowed?: boolean;
  submitLabel: string;
  onSubmit: (
    body: string,
    anonymous: boolean,
    key: string,
  ) => Promise<string | void>;
  onCancel?: () => void;
  onRefresh?: () => Promise<void>;
  attachmentKind?: "answer" | "followup";
  onComplete?: () => void;
  csrfToken?: string;
  onAttachmentUploaded?: (id: string) => Promise<void>;
}) {
  const [body, setBody] = useState(initial);
  const [anonymous, setAnonymous] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string>();
  const attachmentQueue = useAttachmentQueue();
  const attempt = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!createdId && (!body.trim() || body.length > 100000)) {
      setError("Write 1 to 100,000 characters before posting.");
      return;
    }
    if (!createdId && anonymous && !anonymousAllowed) {
      setError(
        "Anonymous posting is disabled for this course. Switch to a named response before posting.",
      );
      return;
    }
    const payload = JSON.stringify({ body, anonymous });
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      const id =
        createdId ?? (await onSubmit(body, anonymous, attempt.current.key));
      if (attachmentKind && id) {
        setCreatedId(id);
        const complete = await attachmentQueue.upload(
          attachmentKind,
          id,
          csrfToken!,
          async () => {
            await onAttachmentUploaded?.(id);
          },
        );
        if (complete) onComplete?.();
      } else onComplete?.();
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
      {createdId ? (
        <p role="status">
          Response posted. Retry failed attachments or finish now.
        </p>
      ) : (
        <MarkdownEditorField
          label={label}
          value={body}
          onChange={setBody}
          disableImages
          disabled={pending}
        />
      )}
      {attachmentKind && (
        <AttachmentSelection queue={attachmentQueue} disabled={pending} />
      )}
      {anonymousAllowed && !createdId && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={anonymous}
            disabled={pending}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          Post anonymously
        </label>
      )}
      {!anonymousAllowed && anonymous && !createdId && (
        <p className="form-message error">
          Anonymous posting is now disabled. Your draft is unchanged.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setAnonymous(false)}
          >
            Switch to named response
          </button>
        </p>
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
          {pending ? "Saving…" : createdId ? "Retry attachments" : submitLabel}
        </button>
        {onCancel && (
          <button
            className="text-button"
            type="button"
            onClick={onCancel}
            disabled={pending}
          >
            {createdId ? "Finish" : "Cancel"}
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

function SavedAnswerBody({ bodyMarkdown }: { bodyMarkdown: string }) {
  return bodyMarkdown.trim() ? (
    <PostBody bodyMarkdown={bodyMarkdown} disableImages />
  ) : (
    <p className="answer-empty">This answer is empty.</p>
  );
}

function AnswerSaveEditor({
  answer,
  csrfToken,
  onSaved,
  onCancel,
  onDiscard,
  beginOperation,
  finishOperation,
  operationGeneration,
}: {
  answer: Answer;
  csrfToken: string;
  onSaved: (saved: Answer, started: number) => void;
  onCancel: () => void;
  onDiscard: (latest: Answer, started: number) => void;
  beginOperation: () => number;
  finishOperation: (changed: boolean) => void;
  operationGeneration: () => number;
}) {
  const [draft, setDraft] = useState(answer.bodyMarkdown);
  const [latest, setLatest] = useState<{
    answer: Answer;
    started: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(base: Answer) {
    if (pending) return;
    if (!draft.trim() || draft.length > 100000) {
      setError("Write 1 to 100,000 characters before saving.");
      return;
    }
    setPending(true);
    setError("");
    const started = beginOperation();
    let changed = false;
    try {
      const saved = await editAnswer(base, draft, csrfToken);
      onSaved(saved, started);
      changed = true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "version_conflict") {
        try {
          const refreshStarted = operationGeneration();
          setLatest({
            answer: await getAnswer(answer.id),
            started: refreshStarted,
          });
          setError(
            "The answer changed. Review both versions before overwriting.",
          );
        } catch (refreshError) {
          setError(message(refreshError));
        }
      } else setError(message(caught));
    } finally {
      finishOperation(changed);
      setPending(false);
    }
  }

  return (
    <div className="response-composer">
      <MarkdownEditorField
        label="Answer"
        value={draft}
        onChange={setDraft}
        disableImages
        disabled={pending}
      />
      {latest && (
        <section
          className="response-conflict"
          role="region"
          aria-label="Answer conflict"
        >
          <h4>Review the latest answer before overwriting</h4>
          <div>
            <h5>Latest saved answer</h5>
            <div className="post-markdown">
              <SavedAnswerBody bodyMarkdown={latest.answer.bodyMarkdown} />
            </div>
            <AttachmentManager
              kind="answer"
              parentId={answer.id}
              attachments={latest.answer.attachments}
              canEdit={false}
              csrfToken={csrfToken}
              onChanged={() => {}}
            />
          </div>
          <div>
            <h5>Your draft</h5>
            <div className="post-markdown">
              <PostBody bodyMarkdown={draft} disableImages />
            </div>
          </div>
          <div className="response-actions">
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => setLatest(null)}
            >
              Continue editing
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => onDiscard(latest.answer, latest.started)}
            >
              Discard my draft
            </button>
            <button
              type="button"
              className="button primary"
              disabled={pending}
              onClick={() => void save(latest.answer)}
            >
              Overwrite with my draft
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
      {!latest && (
        <div className="response-actions">
          <button
            type="button"
            className="button primary"
            disabled={pending}
            onClick={() => void save(answer)}
          >
            {pending ? "Saving…" : "Save answer"}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
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
  onReplace: (next: Answer | ((current: Answer) => Answer)) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const reconcile = useAuthoritativeRefresh(
    answer.id,
    getAnswer,
    (latest) => onReplace(latest),
    setError,
  );
  function replaceProjection(
    next: Answer,
    started: number,
    ownOperation = false,
  ) {
    const keepActivity = reconcile.overlaps(started, ownOperation);
    onReplace((current) => applyAnswerProjection(current, next, keepActivity));
    if (keepActivity) reconcile.refresh();
  }
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
    reconcile.begin();
    let changed = false;
    try {
      if (action === "vote") {
        const voted = await voteAnswer(
          answer,
          !answer.viewerUpvoted,
          props.csrfToken,
        );
        onReplace((current) => ({
          ...current,
          upvoteCount: voted.upvoteCount,
          viewerUpvoted: voted.viewerUpvoted,
        }));
        changed = true;
      }
      if (action === "endorse") {
        onReplace(await endorseAnswer(answer, props.csrfToken));
        changed = true;
      }
      if (action === "delete") {
        await deleteAnswer(answer, props.csrfToken);
        onRemove(answer.id);
        changed = true;
      }
    } catch (caught) {
      setError(message(caught));
    } finally {
      reconcile.finish(changed);
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
      {editing ? (
        <AnswerSaveEditor
          answer={answer}
          csrfToken={props.csrfToken}
          beginOperation={reconcile.begin}
          finishOperation={reconcile.finish}
          operationGeneration={reconcile.generation}
          onCancel={() => setEditing(false)}
          onSaved={(saved, started) => {
            replaceProjection(saved, started, true);
            setEditing(false);
            props.onActivity?.();
          }}
          onDiscard={(latest, started) => {
            replaceProjection(latest, started);
            setEditing(false);
          }}
        />
      ) : (
        <div className="post-markdown response-text">
          <SavedAnswerBody bodyMarkdown={answer.bodyMarkdown} />
        </div>
      )}
      <AttachmentManager
        kind="answer"
        parentId={answer.id}
        attachments={answer.attachments}
        canEdit={canWrite(props) && answer.canEdit && editing}
        csrfToken={props.csrfToken}
        onMutationStart={() => {
          reconcile.begin();
        }}
        onMutationFinish={reconcile.finish}
        onChanged={() => reconcile.refresh()}
      />
      <div className="response-actions">
        <VoteButton
          kind="answer"
          count={answer.upvoteCount}
          voted={answer.viewerUpvoted}
          disabled={!canParticipate(props) || pending}
          onClick={() => void act("vote")}
        />
        {canWrite(props) && answer.canEdit && !editing && (
          <button
            className="text-button edit-button"
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
    canParticipate(props) &&
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
                    items?.map((item) =>
                      typeof next === "function"
                        ? item.id === found.id
                          ? next(item)
                          : item
                        : item.id === next.id && next.version >= item.version
                          ? next
                          : item,
                    ),
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
            {answers && canCreate(kind) && composingKind === kind && (
              <TextComposer
                key={kind}
                label="Your answer"
                submitLabel="Post answer"
                anonymousAllowed={props.allowAnonymousPosting !== false}
                attachmentKind="answer"
                csrfToken={props.csrfToken}
                onComplete={() => {
                  setComposingKind(undefined);
                }}
                onAttachmentUploaded={async (id) => {
                  const updated = await getAnswer(id);
                  setAnswers((items) =>
                    items?.map((item) =>
                      item.id === id
                        ? applyAnswerProjection(item, updated, true)
                        : item,
                    ),
                  );
                }}
                onCancel={() => {
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
                    props.onActivity?.();
                    return created.id;
                  } catch (caught) {
                    if (
                      caught instanceof ApiError &&
                      caught.code === "answer_kind_exists"
                    ) {
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

/** Resolved or Unresolved, as a control for those who may change it. */
function DiscussionStatus({
  item,
  disabled,
  onChange,
}: {
  item: Followup;
  disabled: boolean;
  onChange: (resolved: boolean) => void;
}) {
  const resolved = item.resolved ?? false;
  if (!item.canResolve)
    return (
      <span className={`discussion-status${resolved ? " resolved" : ""}`}>
        {resolved ? "Resolved" : "Unresolved"}
      </span>
    );
  return (
    <div
      className="discussion-status-control"
      role="group"
      aria-label="Discussion status"
    >
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={resolved === value}
          disabled={disabled}
          onClick={() => {
            if (resolved !== value) onChange(value);
          }}
        >
          {value ? "Resolved" : "Unresolved"}
        </button>
      ))}
    </div>
  );
}

function FollowupItem({
  item,
  props,
  onReplace,
  onDelete,
  onThreadReply,
}: {
  item: Followup;
  props: Props;
  onReplace: (next: Followup | ((current: Followup) => Followup)) => void;
  onDelete: (id: string, hasReplies: boolean) => void;
  /** Tells the discussion's root that a reply landed somewhere beneath it. */
  onThreadReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [children, setChildren] = useState<FollowupPage>();
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const reconcile = useAuthoritativeRefresh(
    item.id,
    getFollowup,
    (latest) => onReplace(latest),
    setError,
  );
  function replaceProjection(
    next: Followup,
    started: number,
    ownOperation = false,
  ) {
    const keepActivity = reconcile.overlaps(started, ownOperation);
    onReplace((current) =>
      applyFollowupProjection(current, next, keepActivity),
    );
    if (keepActivity) reconcile.refresh();
  }
  const name = item.deleted
    ? "Deleted followup"
    : (item.author?.displayName ??
      (item.anonymous ? "Anonymous" : "Deleted user"));
  // A new reply anywhere in a discussion reopens it on the server; mirror that.
  const threadReply =
    item.parentId === null
      ? () => onReplace((current) => ({ ...current, resolved: false }))
      : onThreadReply;
  async function resolve(resolved: boolean) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const next = await setFollowupResolved(item, resolved, props.csrfToken);
      onReplace((current) => ({
        ...current,
        resolved: next.resolved,
        canResolve: next.canResolve,
      }));
      props.onActivity?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  async function act(action: "vote" | "delete") {
    if (pending) return;
    if (action === "delete" && !window.confirm("Delete this followup?")) return;
    setPending(true);
    setError("");
    reconcile.begin();
    let changed = false;
    try {
      if (action === "vote") {
        const voted = await voteFollowup(
          item,
          !item.viewerUpvoted,
          props.csrfToken,
        );
        onReplace((current) => ({
          ...current,
          upvoteCount: voted.upvoteCount,
          viewerUpvoted: voted.viewerUpvoted,
        }));
        changed = true;
      } else {
        await deleteFollowup(item, props.csrfToken);
        onDelete(item.id, item.replyCount > 0);
        props.onActivity?.();
        changed = true;
      }
    } catch (caught) {
      setError(message(caught));
    } finally {
      reconcile.finish(changed);
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
      <div className="followup-head">
        <p className="response-byline">{name}</p>
        {item.parentId === null && !item.deleted && (
          <DiscussionStatus
            item={{
              ...item,
              canResolve:
                item.canResolve && props.allowFollowupResolution !== false,
            }}
            disabled={pending || !canWrite(props)}
            onChange={(resolved) => void resolve(resolved)}
          />
        )}
      </div>
      {item.deleted ? (
        <p className="response-tombstone">This followup was deleted.</p>
      ) : editing ? (
        <TextComposer
          label="Followup"
          initial={item.bodyMarkdown ?? ""}
          submitLabel="Save followup"
          onCancel={() => setEditing(false)}
          onRefresh={async () => {
            const started = reconcile.generation();
            const refreshed = await getFollowup(item.id);
            replaceProjection(refreshed, started);
          }}
          onSubmit={async (body) => {
            const started = reconcile.begin();
            let changed = false;
            try {
              const saved = await editFollowup(item, body, props.csrfToken);
              replaceProjection(saved, started, true);
              setEditing(false);
              changed = true;
            } finally {
              reconcile.finish(changed);
            }
          }}
        />
      ) : (
        <div className="post-markdown response-text">
          <PostBody bodyMarkdown={item.bodyMarkdown ?? ""} disableImages />
        </div>
      )}
      {!item.deleted && (
        <AttachmentManager
          kind="followup"
          parentId={item.id}
          attachments={item.attachments ?? []}
          canEdit={canWrite(props) && item.canEdit && editing}
          csrfToken={props.csrfToken}
          onMutationStart={() => {
            reconcile.begin();
          }}
          onMutationFinish={reconcile.finish}
          onChanged={() => reconcile.refresh()}
        />
      )}
      {!item.deleted && (
        <div className="response-actions">
          <VoteButton
            kind="followup"
            count={item.upvoteCount}
            voted={item.viewerUpvoted}
            disabled={!canParticipate(props) || pending}
            onClick={() => void act("vote")}
          />
          {canParticipate(props) && (
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
                className="text-button edit-button"
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
      {replying && canParticipate(props) && (
        <TextComposer
          label="Followup"
          submitLabel="Post reply"
          anonymousAllowed={props.allowAnonymousPosting !== false}
          attachmentKind="followup"
          csrfToken={props.csrfToken}
          onComplete={() => setReplying(false)}
          onAttachmentUploaded={async (id) => {
            const updated = await getFollowup(id);
            setChildren(
              (current) =>
                current && {
                  ...current,
                  data: current.data.map((entry) =>
                    entry.id === id
                      ? applyFollowupProjection(entry, updated, true)
                      : entry,
                  ),
                },
            );
          }}
          onCancel={() => setReplying(false)}
          onSubmit={async (body, anonymous, key) => {
            reconcile.begin();
            let changed = false;
            try {
              const created = await createFollowup(
                item.postId,
                { bodyMarkdown: body, anonymous },
                props.csrfToken,
                key,
                item.id,
              );
              props.onActivity?.();
              threadReply?.();
              setChildren((page) => ({
                data: [...(page?.data ?? []), created].sort(followupOrder),
                meta: {
                  total: (page?.meta.total ?? 0) + 1,
                  nextCursor: page?.meta.nextCursor ?? null,
                },
              }));
              onReplace((current) => ({
                ...current,
                replyCount: current.replyCount + 1,
              }));
              changed = true;
              return created.id;
            } finally {
              reconcile.finish(changed);
            }
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
                onThreadReply={threadReply}
                onReplace={(next) =>
                  setChildren(
                    (page) =>
                      page && {
                        ...page,
                        data: page.data.map((entry) =>
                          typeof next === "function"
                            ? entry.id === child.id
                              ? next(entry)
                              : entry
                            : entry.id === next.id &&
                                next.version >= entry.version
                              ? next
                              : entry,
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
                      onReplace((current) => ({
                        ...current,
                        replyCount: Math.max(0, current.replyCount - 1),
                      }));
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
                      typeof next === "function"
                        ? entry.id === item.id
                          ? next(entry)
                          : entry
                        : entry.id === next.id && next.version >= entry.version
                          ? next
                          : entry,
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
      {canParticipate(props) && !composing && (
        <button
          className="followup-prompt"
          type="button"
          onClick={() => setComposing(true)}
        >
          Compose a new followup discussion
        </button>
      )}
      {composing && canParticipate(props) && (
        <TextComposer
          label="Followup"
          submitLabel="Post followup"
          anonymousAllowed={props.allowAnonymousPosting !== false}
          attachmentKind="followup"
          csrfToken={props.csrfToken}
          onComplete={() => setComposing(false)}
          onAttachmentUploaded={async (id) => {
            const updated = await getFollowup(id);
            setPage(
              (current) =>
                current && {
                  ...current,
                  data: current.data.map((entry) =>
                    entry.id === id
                      ? applyFollowupProjection(entry, updated, true)
                      : entry,
                  ),
                },
            );
          }}
          onCancel={() => setComposing(false)}
          onSubmit={async (body, anonymous, key) => {
            const created = await createFollowup(
              props.postId,
              { bodyMarkdown: body, anonymous },
              props.csrfToken,
              key,
            );
            props.onActivity?.();
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
            return created.id;
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
