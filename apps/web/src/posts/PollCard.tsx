import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  changePollLifecycle,
  clonePoll,
  exportPollResults,
  getPost,
  retractVote,
  votePoll,
  type PollState,
  type Post,
} from "./client.js";

const percent = (count: number, total: number) =>
  total ? Math.round((count / total) * 100) : 0;

type Props = PollState & {
  postId: string;
  /** A course archive also closes voting. */
  closed: boolean;
  /** A locked discussion also stops ballots. */
  discussionLocked?: boolean;
  csrfToken: string;
  staff?: boolean;
  courseActive?: boolean;
  version?: number;
  onChange?: (state: PollState) => void;
  onPostChange?: (post: Post) => void;
  onCloned?: (post: Post) => void;
};

/** Viewer-specific ballot, released results, and staff controls. */
export function PollCard({
  postId,
  options,
  totalVotes,
  selectionMode = "single",
  maxSelections = 1,
  closesAt,
  closed,
  releaseMode = "live",
  resultsReleased = true,
  explanation,
  discussionLocked = false,
  csrfToken,
  staff = false,
  courseActive = true,
  version = 1,
  onChange,
  onPostChange,
  onCloned,
}: Props) {
  const legendId = useId();
  const [state, setState] = useState<PollState>({
    options,
    totalVotes,
    selectionMode,
    maxSelections,
    closesAt,
    closed,
    releaseMode,
    resultsReleased,
    explanation,
  });
  const [revision, setRevision] = useState(version);
  const [choosing, setChoosing] = useState(
    !staff &&
      !options.some((option) => option.selected) &&
      !closed &&
      !discussionLocked,
  );
  const [choices, setChoices] = useState<string[]>(
    options.filter((option) => option.selected).map((option) => option.id),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [exportUrl, setExportUrl] = useState<string>();
  const voted = state.options.some((option) => option.selected);
  const multiple = state.selectionMode === "multiple";
  const maximum = state.maxSelections ?? 1;
  const deadlineElapsed = Boolean(
    state.closesAt && Date.parse(state.closesAt) <= Date.now(),
  );
  const effectiveClosed = Boolean(state.closed || deadlineElapsed);
  const ballotClosed = effectiveClosed || discussionLocked;
  const visibleResults = staff || state.resultsReleased !== false;
  const onPostChangeRef = useRef(onPostChange);
  useEffect(() => {
    onPostChangeRef.current = onPostChange;
  }, [onPostChange]);

  useEffect(() => {
    if (!state.closesAt || state.closed) return;
    const deadline = Date.parse(state.closesAt);
    if (!Number.isFinite(deadline)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const refresh = () => {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        timer = setTimeout(refresh, Math.min(remaining, 2_147_483_647));
        return;
      }
      attempts += 1;
      void getPost(postId, controller.signal)
        .then((post) => {
          if (controller.signal.aborted) return;
          if ("type" in post && post.type === "poll" && post.options) {
            if (!post.closed) {
              retry();
              return;
            }
            setState(post as PollState);
            setChoices(
              post.options
                .filter((option) => option.selected)
                .map((option) => option.id),
            );
            setRevision(post.version);
            setChoosing(false);
            onPostChangeRef.current?.(post);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) retry();
        });
    };
    const retry = () => {
      if (attempts < 60) timer = setTimeout(refresh, 1000);
      else setError("Could not confirm the poll deadline. Refresh this page.");
    };
    timer = setTimeout(
      refresh,
      Math.max(0, Math.min(deadline - Date.now(), 2_147_483_647)),
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [postId, state.closesAt, state.closed]);

  function apply(next: PollState) {
    setState(next);
    setChoices(
      next.options
        .filter((option) => option.selected)
        .map((option) => option.id),
    );
    onChange?.(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choices.length || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await votePoll(
        postId,
        multiple ? choices : choices[0]!,
        csrfToken,
      );
      apply(result);
      setChoosing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voting failed.");
    } finally {
      setPending(false);
    }
  }

  async function retract() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await retractVote(postId, csrfToken);
      const hadVote = state.options.some((option) => option.selected);
      apply({
        ...state,
        options: state.options.map((option) => ({
          ...option,
          selected: false,
          ...(option.voteCount === undefined
            ? {}
            : {
                voteCount: option.voteCount - (option.selected ? 1 : 0),
              }),
        })),
        ...(state.totalVotes === undefined
          ? {}
          : {
              totalVotes: state.totalVotes - (hadVote ? 1 : 0),
            }),
      });
      setChoosing(!effectiveClosed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retracting failed.");
    } finally {
      setPending(false);
    }
  }

  async function lifecycle(action: "close" | "reopen" | "release") {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const post = await changePollLifecycle(
        postId,
        action,
        revision,
        csrfToken,
      );
      setRevision(post.version);
      apply(post as PollState);
      setChoosing(false);
      onPostChange?.(post);
      setNotice(
        action === "release"
          ? "Results released."
          : action === "close"
            ? "Poll closed."
            : "Poll reopened.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Poll update failed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function exportResults() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const blob = await exportPollResults(postId);
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      setExportUrl(URL.createObjectURL(blob));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setPending(false);
    }
  }

  async function clone() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const post = await clonePoll(postId, csrfToken);
      onCloned?.(post);
      setNotice(
        "Poll cloned without ballots, deadline, or released results. Live-release polls become manual-release clones.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cloning failed.");
    } finally {
      setPending(false);
    }
  }

  const total =
    state.totalVotes === undefined
      ? undefined
      : multiple
        ? `${state.totalVotes} ${state.totalVotes === 1 ? "ballot" : "ballots"}`
        : `${state.totalVotes} ${state.totalVotes === 1 ? "vote" : "votes"}`;
  return (
    <section className="poll-card" aria-labelledby={legendId}>
      <h3 id={legendId} className="poll-heading">
        Poll{visibleResults && total ? ` · ${total}` : null}
        {ballotClosed && (
          <span className="poll-closed">
            {" "}
            · {discussionLocked && !effectiveClosed ? "locked" : "closed"}
          </span>
        )}
      </h3>
      {state.closesAt && !effectiveClosed && (
        <p>Closes {new Date(state.closesAt).toLocaleString()}</p>
      )}
      {!visibleResults && <p>Results are not released yet.</p>}
      {!ballotClosed && choosing ? (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="poll-choices">
            <legend className="visually-hidden">
              {multiple
                ? `Choose up to ${maximum} options`
                : "Choose one option"}
            </legend>
            {state.options.map((option) => (
              <label key={option.id} className="poll-choice">
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={`poll-${postId}`}
                  value={option.id}
                  checked={choices.includes(option.id)}
                  disabled={
                    pending ||
                    (multiple &&
                      choices.length >= maximum &&
                      !choices.includes(option.id))
                  }
                  onChange={() =>
                    setChoices((current) =>
                      multiple
                        ? current.includes(option.id)
                          ? current.filter((id) => id !== option.id)
                          : [...current, option.id]
                        : [option.id],
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {multiple && (
            <p className="form-hint">
              Choose up to {maximum} options. {choices.length} selected.
            </p>
          )}
          <div className="poll-actions">
            <button
              type="submit"
              className="button primary compact"
              disabled={!choices.length || pending}
            >
              {pending ? "Voting…" : "Vote"}
            </button>
            {voted && (
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => setChoosing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          {visibleResults ? (
            <ul className="poll-results">
              {state.options.map((option) => {
                const share = percent(
                  option.voteCount ?? 0,
                  state.totalVotes ?? 0,
                );
                return (
                  <li
                    key={option.id}
                    className={option.selected ? "selected" : undefined}
                  >
                    <div className="poll-result-label">
                      <span>
                        {option.label}
                        {option.selected && (
                          <span className="poll-your-vote"> · your vote</span>
                        )}
                      </span>
                      <span>
                        {option.voteCount ?? 0} ({share}%)
                      </span>
                    </div>
                    <div className="poll-bar" aria-hidden="true">
                      <span style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="poll-results">
              {state.options.map((option) => (
                <li key={option.id}>
                  {option.label}
                  {option.selected && " · your vote"}
                </li>
              ))}
            </ul>
          )}
          {visibleResults && state.explanation && (
            <p className="poll-explanation">{state.explanation}</p>
          )}
          {!ballotClosed && (
            <div className="poll-actions">
              <button
                type="button"
                className="button secondary compact"
                disabled={pending}
                onClick={() => setChoosing(true)}
              >
                {voted ? "Change vote" : "Vote"}
              </button>
              {voted && (
                <button
                  type="button"
                  className="text-button"
                  disabled={pending}
                  onClick={() => void retract()}
                >
                  Retract vote
                </button>
              )}
            </div>
          )}
        </>
      )}
      {staff && (
        <div className="poll-staff-controls">
          <div className="poll-actions" aria-label="Poll staff actions">
            {courseActive && (
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() =>
                  void lifecycle(effectiveClosed ? "reopen" : "close")
                }
              >
                {effectiveClosed ? "Reopen poll" : "Close poll"}
              </button>
            )}
            {courseActive && !state.resultsReleased && (
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => void lifecycle("release")}
              >
                Release results
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => void exportResults()}
            >
              Export results
            </button>
            {exportUrl && (
              <a href={exportUrl} download={`poll-${postId}-results.csv`}>
                Download CSV
              </a>
            )}
            {courseActive && (
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => void clone()}
              >
                Clone poll
              </button>
            )}
          </div>
          <p className="form-hint">
            Clones start without ballots, a deadline, or released results.
            Live-release polls become manual-release clones.
          </p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
