import { useId, useState, type FormEvent } from "react";
import {
  retractVote,
  votePoll,
  type PollOption,
  type PollState,
} from "./client.js";

const percent = (count: number, total: number) =>
  total ? Math.round((count / total) * 100) : 0;

/** A poll's choices: a vote form until the viewer votes, then the results. */
export function PollCard({
  postId,
  options,
  totalVotes,
  closed,
  csrfToken,
  onChange,
}: {
  postId: string;
  options: PollOption[];
  totalVotes: number;
  /** Archived courses show results only. */
  closed: boolean;
  csrfToken: string;
  onChange?: (state: PollState) => void;
}) {
  const legendId = useId();
  const [state, setState] = useState<PollState>({ options, totalVotes });
  const voted = state.options.some((option) => option.selected);
  const [choosing, setChoosing] = useState(!voted && !closed);
  const [choice, setChoice] = useState(
    state.options.find((option) => option.selected)?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  function apply(next: PollState) {
    setState(next);
    onChange?.(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await votePoll(postId, choice, csrfToken);
      apply({ options: result.options, totalVotes: result.totalVotes });
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
      const chosen = state.options.find((option) => option.selected);
      apply({
        options: state.options.map((option) =>
          option.selected
            ? { ...option, selected: false, voteCount: option.voteCount - 1 }
            : option,
        ),
        totalVotes: chosen ? state.totalVotes - 1 : state.totalVotes,
      });
      setChoice("");
      setChoosing(!closed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retracting failed.");
    } finally {
      setPending(false);
    }
  }

  const total = `${state.totalVotes} ${state.totalVotes === 1 ? "vote" : "votes"}`;
  return (
    <section className="poll-card" aria-labelledby={legendId}>
      <h3 id={legendId} className="poll-heading">
        Poll · {total}
        {closed && <span className="poll-closed"> · closed</span>}
      </h3>
      {choosing ? (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="poll-choices">
            <legend className="visually-hidden">Choose one option</legend>
            {state.options.map((option) => (
              <label key={option.id} className="poll-choice">
                <input
                  type="radio"
                  name={`poll-${postId}`}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="poll-actions">
            <button
              type="submit"
              className="button primary compact"
              disabled={!choice || pending}
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
          <ul className="poll-results">
            {state.options.map((option) => {
              const share = percent(option.voteCount, state.totalVotes);
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
                      {option.voteCount} ({share}%)
                    </span>
                  </div>
                  <div className="poll-bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {!closed && (
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
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
