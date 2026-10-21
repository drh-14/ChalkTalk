import { useId, useState, type FormEvent } from "react";
import {
  createAnswer,
  createFollowup,
  editAnswer,
  getAnswer,
  listAnswers,
  type Answer,
} from "../answers/client.js";
import { uploadAttachment } from "../attachments/client.js";
import { ApiError } from "../auth/client.js";
import type { SessionLanguage } from "./client.js";
import { codeBlock, postBody } from "./postFormatting.js";

export type PostContent =
  | { kind: "code"; code: string; language: SessionLanguage }
  | { kind: "board"; file: File };

type Destination = "followup" | "answer";

const key = () => crypto.randomUUID();

/** Appends to the staff answer, retrying once on a concurrent edit. */
async function appendToAnswer(
  answer: Answer,
  addition: string,
  csrfToken: string,
): Promise<Answer> {
  const append = (current: Answer) =>
    editAnswer(
      current,
      `${current.bodyMarkdown.trimEnd()}\n\n${addition}`,
      csrfToken,
    );
  try {
    return await append(answer);
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.status !== 412) throw caught;
    return append(await getAnswer(answer.id));
  }
}

/** Posts session code or the whiteboard to the session's question. */
export function PostToDiscussion({
  postId,
  postPath,
  sessionTitle,
  staff,
  csrfToken,
  content,
  onClose,
  onNavigate,
}: {
  postId: string;
  postPath: string;
  sessionTitle: string;
  staff: boolean;
  csrfToken: string;
  content: PostContent;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const headingId = useId();
  const [note, setNote] = useState("");
  const [destination, setDestination] = useState<Destination>("followup");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [posted, setPosted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    const bodyMarkdown =
      content.kind === "code"
        ? postBody(note, codeBlock(content.code, content.language))
        : note.trim() || `Whiteboard from the live session "${sessionTitle}".`;
    try {
      let target: { kind: "followup" | "answer"; id: string };
      if (destination === "followup") {
        const followup = await createFollowup(
          postId,
          { bodyMarkdown, anonymous: false },
          csrfToken,
          key(),
        );
        target = { kind: "followup", id: followup.id };
      } else {
        const existing = (await listAnswers(postId)).find(
          (answer) => answer.kind === "staff",
        );
        const answer = existing
          ? await appendToAnswer(existing, bodyMarkdown, csrfToken)
          : await createAnswer(
              postId,
              { bodyMarkdown, anonymous: false },
              csrfToken,
              key(),
            );
        target = { kind: "answer", id: answer.id };
      }
      if (content.kind === "board")
        await uploadAttachment(
          target.kind,
          target.id,
          content.file,
          csrfToken,
          key(),
        );
      setPosted(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Posting failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="session-post-backdrop">
      <section
        className="session-post-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h3 id={headingId}>
          {content.kind === "code"
            ? "Post code to the discussion"
            : "Post the whiteboard to the discussion"}
        </h3>
        {posted ? (
          <>
            <p role="status">
              Posted.{" "}
              <a
                href={postPath}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(postPath);
                }}
              >
                View the post
              </a>
            </p>
            <div className="session-post-actions">
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label className="session-post-note">
              Note (optional)
              <textarea
                value={note}
                rows={3}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {staff && (
              <fieldset className="session-post-destination">
                <legend>Post as</legend>
                {(
                  [
                    ["followup", "Followup"],
                    ["answer", "Staff answer"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="session-post-destination"
                      value={value}
                      checked={destination === value}
                      onChange={() => setDestination(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="session-post-hint">
              {content.kind === "code"
                ? "The current code is added as a code block. Posts show your name."
                : "The board is attached as a PNG image. Posts show your name."}
            </p>
            {error && (
              <p className="form-message error" role="alert">
                {error}
              </p>
            )}
            <div className="session-post-actions">
              <button
                type="submit"
                className="button primary"
                disabled={pending}
              >
                {pending ? "Posting…" : "Post"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
