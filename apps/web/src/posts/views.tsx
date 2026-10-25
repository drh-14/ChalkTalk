import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ApiError } from "../auth/client.js";
import { ActiveSessionLink, SessionsPanel } from "../sessions/SessionsPanel.js";
import { CourseLiveSessions } from "../sessions/LiveSessionLists.js";
import { sessionRoute, type CodeSession } from "../sessions/client.js";
import { PostBody } from "./PostBody.js";
import { MarkdownEditorField } from "./MarkdownEditorField.js";
import { MentionContext, mentionSuggestions } from "./mentions.js";
import { QuestionResponses } from "../answers/views.js";
import {
  AttachmentManager,
  AttachmentSelection,
} from "../attachments/views.js";
import { deleteAttachment } from "../attachments/client.js";
import { useAttachmentQueue } from "../attachments/queue.js";
import { getCourse, getMembership, type Course } from "../courses/client.js";
import {
  confirmMergePost,
  createPost,
  deletePostDraft,
  getPostDraft,
  getDuplicateReview,
  getPost,
  listMergedPosts,
  listPosts,
  makePostPublic,
  markCourseRead,
  setFollowing,
  setPostPinned,
  unmergePost,
  updatePost,
  updatePostDraft,
  type CreatePostInput,
  type MergedPost,
  type Post,
  type PostDetail,
  type PostDraftContent,
  type DraftRevision,
  type PostListOptions,
  type PostSort,
} from "./client.js";
import {
  feedSearch,
  hasFilters,
  hasTag,
  MAX_FEED_TAGS,
  type FeedFilters,
} from "../app/routes.js";
import { formatPostTime } from "./time.js";
import { PollCard } from "./PollCard.js";
import {
  feedFilters,
  postStatuses,
  postTypeOf,
  type FeedFilter,
  type PostStatus,
} from "./types.js";

/** Builds the course feed request; a search always sends its sort, otherwise only a non-default one. */
function feedOptions(
  query: string | undefined,
  filter: FeedFilter | undefined,
  sort: PostSort,
  tags: string[],
  tagMatch: "any" | undefined,
): PostListOptions {
  return {
    ...(query
      ? { q: query, sort }
      : sort !== "recent_activity"
        ? { sort }
        : {}),
    ...filter?.options,
    ...(tags.length ? { tags, ...(tagMatch ? { tagMatch } : {}) } : {}),
  };
}

function PostTypeBadge({ type }: { type: string }) {
  const config = postTypeOf(type);
  return (
    <span className={`post-type-badge ${config.tone}`}>{config.label}</span>
  );
}

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const discussionPath = (courseId: string, search = "") =>
  `/courses/${encodeURIComponent(courseId)}${search}`;
const postPath = (courseId: string, postId: string, search = "") =>
  `/courses/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(postId)}${search}`;

function PostByline({ post }: { post: Post }) {
  const time = formatPostTime(post.createdAt);
  return (
    <>
      {post.author.displayName}
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
    </>
  );
}

/** Notice on a private post, with Make public for its author and staff. */
function PrivateNotice({
  post,
  own,
  canPublish,
  csrfToken,
  onPublished,
}: {
  post: Post;
  /** Whether the viewer wrote the post. */
  own: boolean;
  canPublish: boolean;
  csrfToken: string;
  onPublished: (post: Post) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function publish() {
    if (
      pending ||
      !window.confirm(
        "Everyone in the course will be able to see this post. This cannot be undone.",
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      onPublished(await makePostPublic(post, csrfToken));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="private-notice" role="note">
      <span>
        {own
          ? "Only you and course staff can see this."
          : "Only the author and course staff can see this."}
      </span>
      {canPublish && (
        <button
          type="button"
          className="button secondary compact"
          disabled={pending}
          onClick={() => void publish()}
        >
          {pending ? "Making public…" : "Make public"}
        </button>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Follow or unfollow a post to choose whether its activity notifies the viewer. */
function FollowButton({
  post,
  csrfToken,
  onChange,
}: {
  post: Post;
  csrfToken: string;
  onChange: (following: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const following = post.following ?? false;
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      onChange(await setFollowing(post.id, !following, csrfToken));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={`button secondary compact follow-button${following ? " following" : ""}`}
        aria-pressed={following}
        disabled={pending}
        onClick={() => void toggle()}
        title={
          following
            ? "You are notified of new answers, followups, and replies"
            : "Get notified of new answers, followups, and replies"
        }
      >
        {following ? "Following" : "Follow"}
      </button>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function PostStatusBadge({ status }: { status: PostStatus }) {
  if (status.icon === "pin")
    return (
      <span className="post-status pin" title={status.label}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            d="M12 17v5M9 10.76V6H8a2 2 0 0 1 0-4h8a2 2 0 0 1 0 4h-1v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="visually-hidden">{status.label}</span>
      </span>
    );
  return <span className={`post-status ${status.tone}`}>{status.label}</span>;
}

function TagList({
  tags,
  active,
  onSelect,
}: {
  tags: string[];
  active?: string[];
  onSelect: (tag: string) => void;
}) {
  if (!tags.length) return null;
  return (
    <ul className="tag-list" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <button
            type="button"
            className={`tag-chip${hasTag(active, tag) ? " active" : ""}`}
            aria-pressed={hasTag(active, tag)}
            aria-label={`Filter by tag ${tag}`}
            onClick={() => onSelect(tag)}
          >
            #{tag}
          </button>
        </li>
      ))}
    </ul>
  );
}

const SORTS: readonly PostSort[] = [
  "relevance",
  "recent_activity",
  "newest",
  "oldest",
];
const SORT_LABELS: Record<PostSort, string> = {
  relevance: "Best match",
  recent_activity: "Last updated",
  newest: "Newest",
  oldest: "Oldest",
};

/** Sidebar sections open on wide screens and start closed on phones, decided once per visit. */
function initiallyOpen() {
  return !(
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(min-width: 851px)").matches
  );
}

/** An accordion section of the filter sidebar; a closed header also names the current choice. */
function FilterSection({
  name,
  summary,
  open,
  onToggle,
  children,
}: {
  name: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <section className={`filter-section${open ? " open" : ""}`}>
      <h2 className="filter-section-heading">
        <button
          type="button"
          className="filter-section-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span>
            {name}
            {!open && (
              <>
                {" "}
                <span className="filter-section-summary">· {summary}</span>
              </>
            )}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      <div id={panelId} className="filter-section-panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Single-choice rows built on native radios, so arrow keys and disabling work as usual. */
function ChoiceGroup({
  name,
  value,
  choices,
  disabled,
  showLegend,
  className,
  onChange,
}: {
  name: string;
  value: string;
  choices: { value: string; label: string; nested?: boolean }[];
  disabled?: boolean;
  showLegend?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const inputName = useId();
  return (
    <fieldset
      className={`filter-choices${className ? ` ${className}` : ""}`}
      disabled={disabled}
    >
      <legend className={showLegend ? undefined : "visually-hidden"}>
        {name}
      </legend>
      {choices.map((choice) => (
        <label
          key={choice.value}
          className={`filter-choice${choice.nested ? " nested" : ""}`}
        >
          <input
            type="radio"
            className="visually-hidden"
            name={inputName}
            value={choice.value}
            checked={choice.value === value}
            onChange={() => onChange(choice.value)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The post view also shows when a post last had activity, if that came after its creation. */
function ActivityTime({ post }: { post: Post }) {
  const time = formatPostTime(post.lastActivityAt);
  if (!time || !(Date.parse(post.lastActivityAt) > Date.parse(post.createdAt)))
    return null;
  return (
    <>
      {" "}
      <time className="post-time" dateTime={time.dateTime} title={time.title}>
        active {time.label}
      </time>
    </>
  );
}

function relatedQuery(title: string, body: string): string {
  const words = (value: string) =>
    Array.from(
      value.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu),
      (match) => match[0]!,
    ).filter((word) => word.length >= 2 && word !== "or");
  const titleWords = [...new Set(words(title))];
  const bodyWords = [
    ...new Set(
      words(body)
        .map((word) => word.slice(0, 40))
        .reverse(),
    ),
  ]
    .slice(0, 4)
    .reverse()
    .filter((word) => !titleWords.includes(word));
  const selected = [...titleWords];
  for (const word of bodyWords)
    if ([...selected, word].join(" OR ").length <= 500) selected.push(word);
  return selected.join(" OR ");
}

function relatedSemanticQuery(title: string, body: string): string {
  const heading = title.trim().slice(0, 200);
  const sample = body.trim().slice(0, 500 - heading.length - 1);
  return [heading, sample].filter(Boolean).join(" ");
}
const MAX_POLL_OPTIONS = 10;
const MAX_DRAFT_FIELD_LENGTH = 200;

function draftFingerprint(content: PostDraftContent) {
  return JSON.stringify({
    type: content.type,
    title: content.title,
    bodyMarkdown: content.bodyMarkdown,
    anonymous: content.anonymous,
    tags: content.tags,
    ...(content.type === "poll" ? { options: content.options ?? [] } : {}),
    ...(content.announcement ? { announcement: true } : {}),
    ...(content.private ? { private: true } : {}),
  });
}

function parseComposerTags(value: string): string[] {
  const result: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  let closedQuote = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\" && quoted && value[index + 1] === "\\") {
      field += "\\";
      index++;
    } else if (
      character === "\\" &&
      quoted &&
      value[index + 1] === "u" &&
      /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))
    ) {
      field += String.fromCharCode(
        parseInt(value.slice(index + 2, index + 6), 16),
      );
      index += 5;
    } else if (character === '"' && quoted && value[index + 1] === '"') {
      field += '"';
      index++;
    } else if (character === '"' && quoted) {
      quoted = false;
      closedQuote = true;
    } else if (character === '"' && !field.trim()) {
      field = "";
      quoted = true;
      wasQuoted = true;
    } else if (character === "," && !quoted) {
      if (wasQuoted || field.trim())
        result.push(wasQuoted ? field : field.trim());
      field = "";
      wasQuoted = false;
      closedQuote = false;
    } else if (closedQuote && /\s/.test(character)) {
      continue;
    } else {
      field += character;
    }
  }
  if (wasQuoted || field.trim()) result.push(wasQuoted ? field : field.trim());
  return result;
}

function formatComposerTags(tags: string[]): string {
  return tags
    .map((tag) => {
      const quoted =
        tag === "" ||
        tag !== tag.trim() ||
        [...tag].some((character) => {
          const code = character.charCodeAt(0);
          return (
            character === "," || character === '"' || code < 32 || code === 127
          );
        });
      if (!quoted) return tag;
      const encoded = [...tag]
        .map((character) => {
          if (character === "\\") return "\\\\";
          if (character === '"') return '""';
          const code = character.charCodeAt(0);
          return code < 32 || code === 127
            ? `\\u${code.toString(16).padStart(4, "0")}`
            : character;
        })
        .join("");
      return `"${encoded}"`;
    })
    .join(", ");
}

function editDraftMetadataText(
  original: string,
  edited: string,
  caret: number,
): string {
  if (!original.includes("\r"))
    return edited.length <= MAX_DRAFT_FIELD_LENGTH ? edited : original;
  let displayed = "";
  const offsets = [0];
  for (let index = 0; index < original.length; index++) {
    if (original[index] === "\r") {
      if (original[index + 1] === "\n") index++;
      displayed += "\n";
    } else {
      displayed += original[index];
    }
    offsets.push(index + 1);
  }
  if (displayed === edited) return original;
  const prefixLimit = Math.max(
    0,
    caret - Math.max(0, edited.length - displayed.length),
  );
  let prefix = 0;
  while (
    prefix < prefixLimit &&
    prefix < displayed.length &&
    prefix < edited.length &&
    displayed[prefix] === edited[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < displayed.length - prefix &&
    suffix < edited.length - prefix &&
    displayed[displayed.length - suffix - 1] ===
      edited[edited.length - suffix - 1]
  )
    suffix++;
  const translated =
    original.slice(0, offsets[prefix]) +
    edited.slice(prefix, edited.length - suffix) +
    original.slice(offsets[displayed.length - suffix]);
  return translated.length <= MAX_DRAFT_FIELD_LENGTH ? translated : original;
}

function Composer({
  courseId,
  csrfToken,
  staff = false,
  archived = false,
  onCreated,
  onClose,
  onDiscardLocalChanges,
  onLeaveRequestChange,
  onStateChange,
  initialTitle = "",
}: {
  courseId: string;
  csrfToken: string;
  /** TAs and instructors may post polls and announcements. */
  staff?: boolean;
  archived?: boolean;
  onCreated: (post: Post) => void;
  onClose: () => void;
  onDiscardLocalChanges: () => void;
  onLeaveRequestChange: (guard: () => boolean) => void;
  onStateChange: (dirty: boolean, pending: boolean) => void;
  /** A starting title, such as a search the reader chose to ask as a question. */
  initialTitle?: string;
}) {
  const [type, setType] = useState<"question" | "note" | "poll">("question");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [announcement, setAnnouncement] = useState(false);
  const [audience, setAudience] = useState<"course" | "staff">("course");
  const [title, setTitle] = useState(initialTitle);
  const bodyField = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialTitle)
      bodyField.current?.querySelector<HTMLElement>(".cm-content")?.focus();
    // Focus moves once, when a search opens the composer with a title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [body, setBody] = useState("");
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [anonymous, setAnonymous] = useState(false);
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);
  const [switchingDraft, setSwitchingDraft] = useState(false);
  const [error, setError] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [draftLoadPending, setDraftLoadPending] = useState(true);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [draftStatus, setDraftStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "conflict"
  >("idle");
  const [draftError, setDraftError] = useState("");
  const [leaveNotice, setLeaveNotice] = useState("");
  const [revision, setRevision] = useState<DraftRevision>();
  const revisionRef = useRef<DraftRevision | undefined>(undefined);
  const savePromise = useRef<Promise<boolean> | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const conflictRef = useRef(false);
  const [published, setPublished] = useState<Post>();
  const attachmentQueue = useAttachmentQueue();
  const [suggestions, setSuggestions] = useState<Post[]>([]);
  const [suggestionsState, setSuggestionsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const lastAttempt = useRef<{ body: string; key: string } | undefined>(
    undefined,
  );
  const query = relatedQuery(title, body);
  const draftContent = useMemo<PostDraftContent>(
    () => ({
      type,
      title,
      bodyMarkdown: body,
      anonymous,
      tags: parseComposerTags(tags),
      ...(type === "poll" ? { options: pollOptions } : {}),
      ...(type === "note" && announcement ? { announcement: true } : {}),
      ...(type !== "poll" && audience === "staff" ? { private: true } : {}),
    }),
    [type, title, body, anonymous, tags, pollOptions, announcement, audience],
  );
  const contentRef = useRef(draftContent);
  contentRef.current = draftContent;
  const savedContent = useRef(
    draftFingerprint({
      type: "question",
      title: "",
      bodyMarkdown: "",
      anonymous: false,
      tags: [],
    }),
  );
  const applyDraft = useCallback((next: DraftRevision) => {
    const content = next.draft.content;
    if (
      !next.draft ||
      !Number.isSafeInteger(next.draft.version) ||
      (content !== null &&
        (!["question", "note", "poll"].includes(content.type) ||
          typeof content.title !== "string" ||
          typeof content.bodyMarkdown !== "string" ||
          typeof content.anonymous !== "boolean" ||
          !Array.isArray(content.tags)))
    )
      throw new Error("Invalid saved draft response.");
    revisionRef.current = next;
    setRevision(next);
    if (content) {
      savedContent.current = draftFingerprint(content);
      setRestoredDraft(true);
      setType(content.type);
      setTitle(content.title);
      setBody(content.bodyMarkdown);
      setEditorGeneration((generation) => generation + 1);
      setAnonymous(content.anonymous);
      setTags(formatComposerTags(content.tags));
      setPollOptions(content.options ?? ["", ""]);
      setAnnouncement(Boolean(content.announcement));
      setAudience(content.private ? "staff" : "course");
    } else {
      savedContent.current = draftFingerprint({
        type: "question",
        title: "",
        bodyMarkdown: "",
        anonymous: false,
        tags: [],
      });
      setRestoredDraft(false);
    }
  }, []);
  const loadDraft = useCallback(
    async (isActive: () => boolean) => {
      setDraftLoadPending(true);
      try {
        const next = await getPostDraft(courseId);
        if (!isActive()) return;
        applyDraft(next);
        setDraftStatus(next.draft.content ? "saved" : "idle");
        setLoadingDraft(false);
        setDraftError("");
      } catch (caught) {
        if (isActive()) setDraftError(`Draft not loaded: ${message(caught)}`);
      } finally {
        if (isActive()) setDraftLoadPending(false);
      }
    },
    [applyDraft, courseId],
  );
  useEffect(() => {
    let active = true;
    void loadDraft(() => active);
    return () => {
      active = false;
    };
  }, [loadDraft]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (archived || loadingDraft || conflictRef.current || !revisionRef.current)
      return false;
    if (savePromise.current) return savePromise.current;
    const snapshot = draftFingerprint(contentRef.current);
    if (snapshot === savedContent.current) return true;
    setDraftStatus("saving");
    setDraftError("");
    const request = updatePostDraft(
      courseId,
      revisionRef.current.etag,
      contentRef.current,
      csrfToken,
    );
    const pendingSave = request
      .then((next) => {
        revisionRef.current = next;
        setRevision(next);
        savedContent.current = snapshot;
        const changedDuringSave =
          draftFingerprint(contentRef.current) !== snapshot;
        setDraftStatus(changedDuringSave ? "idle" : "saved");
        setLeaveNotice((current) =>
          current && !changedDuringSave
            ? "Draft saved. You can leave now."
            : current,
        );
        if (changedDuringSave) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => void saveDraft(), 700);
        }
        return true;
      })
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 412) {
          conflictRef.current = true;
          setDraftStatus("conflict");
          setDraftError(
            "This draft changed elsewhere. Your local text is still here.",
          );
        } else {
          setDraftStatus("error");
          setDraftError(`Draft not saved: ${message(caught)}`);
        }
        setLeaveNotice((current) =>
          current
            ? "Draft was not saved. Retry or discard unsaved changes to leave."
            : current,
        );
        return false;
      })
      .finally(() => {
        savePromise.current = undefined;
      });
    savePromise.current = pendingSave;
    return pendingSave;
  }, [archived, courseId, csrfToken, loadingDraft]);

  useEffect(() => {
    if (
      archived ||
      published ||
      conflictRef.current ||
      loadingDraft ||
      switchingDraft
    )
      return;
    if (draftFingerprint(draftContent) === savedContent.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveDraft();
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
  }, [
    archived,
    draftContent,
    published,
    saveDraft,
    loadingDraft,
    switchingDraft,
  ]);

  function prepareToLeave() {
    if (switchingDraft || loadingDraft) return false;
    if (archived || published) return true;
    if (savePromise.current) {
      setLeaveNotice(
        "Saving latest draft before leaving. Try again when saved.",
      );
      return false;
    }
    if (conflictRef.current) {
      setLeaveNotice(
        "This draft changed elsewhere. Reload or confirm overwrite before leaving.",
      );
      return false;
    }
    if (draftFingerprint(contentRef.current) === savedContent.current)
      return true;
    if (draftStatus === "error") {
      setLeaveNotice(
        "Draft was not saved. Retry or discard unsaved changes to leave.",
      );
      return false;
    }
    window.clearTimeout(saveTimer.current);
    setLeaveNotice("Saving latest draft before leaving. Try again when saved.");
    void saveDraft();
    return false;
  }
  useEffect(() => {
    onLeaveRequestChange(prepareToLeave);
  });

  async function reloadDraft() {
    if (switchingDraft || savePromise.current) return;
    if (!window.confirm("Replace local changes with the saved draft?")) return;
    setSwitchingDraft(true);
    window.clearTimeout(saveTimer.current);
    try {
      const next = await getPostDraft(courseId);
      if (next.draft.content === null) {
        setType("question");
        setTitle("");
        setBody("");
        setEditorGeneration((generation) => generation + 1);
        setAnonymous(false);
        setTags("");
        setPollOptions(["", ""]);
        setAnnouncement(false);
        setAudience("course");
      }
      applyDraft(next);
      conflictRef.current = false;
      setDraftStatus(next.draft.content ? "saved" : "idle");
      setDraftError("");
    } catch (caught) {
      setDraftError(message(caught));
    } finally {
      setSwitchingDraft(false);
    }
  }

  async function overwriteDraft() {
    if (switchingDraft || savePromise.current) return;
    if (!window.confirm("Overwrite the saved draft with your local changes?"))
      return;
    setSwitchingDraft(true);
    const local = contentRef.current;
    const snapshot = draftFingerprint(local);
    try {
      const current = await getPostDraft(courseId);
      const next = await updatePostDraft(
        courseId,
        current.etag,
        local,
        csrfToken,
      );
      revisionRef.current = next;
      setRevision(next);
      savedContent.current = snapshot;
      conflictRef.current = false;
      setDraftStatus(
        draftFingerprint(contentRef.current) === snapshot ? "saved" : "idle",
      );
      setDraftError("");
    } catch (caught) {
      setDraftStatus("conflict");
      setDraftError(`Draft not saved: ${message(caught)}`);
    } finally {
      setSwitchingDraft(false);
    }
  }

  async function discardDraft() {
    if (!revisionRef.current || switchingDraft || savePromise.current) return;
    if (!window.confirm("Discard this saved draft?")) return;
    if (
      attachmentQueue.files.length > 0 &&
      !window.confirm("Queued attachments are not saved. Discard them too?")
    )
      return;
    setSwitchingDraft(true);
    window.clearTimeout(saveTimer.current);
    try {
      const next = await deletePostDraft(
        courseId,
        revisionRef.current.etag,
        csrfToken,
      );
      attachmentQueue.files.forEach((item) => attachmentQueue.remove(item.key));
      revisionRef.current = next;
      setRevision(next);
      savedContent.current = draftFingerprint({
        type: "question",
        title: "",
        bodyMarkdown: "",
        anonymous: false,
        tags: [],
      });
      conflictRef.current = false;
      setRestoredDraft(false);
      setType("question");
      setTitle("");
      setBody("");
      setEditorGeneration((generation) => generation + 1);
      setAnonymous(false);
      setTags("");
      setPollOptions(["", ""]);
      setAnnouncement(false);
      setAudience("course");
      setDraftStatus("idle");
      setDraftError("");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 412) {
        conflictRef.current = true;
        setDraftStatus("conflict");
        setDraftError(
          "This draft changed elsewhere. Your local text is still here.",
        );
      } else {
        setDraftError(message(caught));
      }
    } finally {
      setSwitchingDraft(false);
    }
  }

  useEffect(() => {
    onStateChange(
      Boolean(attachmentQueue.files.length > 0 || published),
      pending || switchingDraft,
    );
  }, [
    onStateChange,
    pending,
    switchingDraft,
    attachmentQueue.files.length,
    published,
  ]);

  useEffect(() => {
    if (type !== "question" || !query) {
      setSuggestions([]);
      setSuggestionsState("idle");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setSuggestions([]);
    setSuggestionsState("loading");
    const timer = window.setTimeout(() => {
      void listPosts(courseId, {
        q: query,
        semanticQuery: relatedSemanticQuery(title, body),
        sort: "relevance",
        type: "question",
        limit: 10,
        signal: controller.signal,
      })
        .then((page) => {
          if (active) {
            setSuggestions(page.data.slice(0, 10));
            setSuggestionsState("ready");
          }
        })
        .catch(() => {
          if (active) setSuggestionsState("error");
        });
    }, 300);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [courseId, query, title, body, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || switchingDraft || loadingDraft || archived) return;
    if (published) {
      setPending(true);
      const complete = await attachmentQueue.upload(
        "post",
        published.id,
        csrfToken,
      );
      setPending(false);
      if (complete) onCreated(published);
      return;
    }
    const privately = type !== "poll" && audience === "staff";
    const announcing = type === "note" && announcement && !privately;
    const labels = pollOptions.map((label) => label.trim());
    const input: CreatePostInput = {
      type,
      title: title.trim(),
      bodyMarkdown: body,
      anonymous: announcing ? false : anonymous,
      tags: parseComposerTags(tags),
      ...(type === "poll"
        ? { options: labels.filter(Boolean).map((label) => ({ label })) }
        : {}),
      ...(announcing ? { announcement: true } : {}),
      ...(privately ? { private: true } : {}),
    };
    if (type === "poll") {
      const filled = labels.filter(Boolean);
      if (filled.length < 2) {
        setError("A poll needs at least 2 options.");
        return;
      }
      if (filled.some((label) => label.length > 200)) {
        setError("Poll options must be at most 200 characters.");
        return;
      }
      if (
        new Set(filled.map((label) => label.toLowerCase())).size !==
        filled.length
      ) {
        setError("Poll options must be different from each other.");
        return;
      }
    }
    if (!input.title || input.title.length > 200) {
      setError("Post title must be between 1 and 200 characters.");
      return;
    }
    if (!input.bodyMarkdown.trim() || input.bodyMarkdown.length > 100000) {
      setError("Post body must be between 1 and 100,000 characters.");
      return;
    }
    if (input.tags.length > 10 || input.tags.some((tag) => tag.length > 40)) {
      setError("Use at most 10 tags of 40 characters each.");
      return;
    }
    window.clearTimeout(saveTimer.current);
    setPending(true);
    setError("");
    let postCreated = false;
    try {
      if (savePromise.current && !(await savePromise.current)) return;
      if (draftFingerprint(contentRef.current) !== savedContent.current) {
        if (!(await saveDraft())) return;
      }
      if (conflictRef.current) return;
      input.draftVersion = revisionRef.current?.draft.version;
      const payload = JSON.stringify(input);
      const key =
        lastAttempt.current?.body === payload
          ? lastAttempt.current.key
          : crypto.randomUUID();
      lastAttempt.current = { body: payload, key };
      const created = await createPost(courseId, input, csrfToken, key);
      postCreated = true;
      setPublished(created);
      const complete = await attachmentQueue.upload(
        "post",
        created.id,
        csrfToken,
      );
      if (complete) onCreated(created);
    } catch (caught) {
      if (!postCreated && caught instanceof ApiError && caught.status === 412) {
        conflictRef.current = true;
        setDraftStatus("conflict");
        setDraftError(
          "This draft changed elsewhere. Your local text is still here.",
        );
      } else {
        setError(message(caught));
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="post-composer" aria-label="Create a post">
      <div className="section-title">
        <h2>Create a post</h2>
        <button type="button" className="text-button" onClick={onClose}>
          Close composer
        </button>
      </div>
      {restoredDraft && (
        <p role="status">Saved draft restored for this course.</p>
      )}
      {loadingDraft && <p role="status">Loading saved draft…</p>}
      {loadingDraft && draftError && (
        <button
          type="button"
          className="text-button"
          disabled={draftLoadPending}
          onClick={() => void loadDraft(() => true)}
        >
          Retry loading draft
        </button>
      )}
      {!loadingDraft && revision?.draft.content && !published && (
        <button
          type="button"
          className="text-button"
          disabled={pending || switchingDraft}
          onClick={() => void discardDraft()}
        >
          Discard draft
        </button>
      )}
      {archived && (
        <p role="status">
          This course is archived. Drafts can be read or discarded, but not
          edited or published.
        </p>
      )}
      {draftStatus === "saving" && <p role="status">Saving draft…</p>}
      {draftStatus === "saved" && <p role="status">Draft saved.</p>}
      {leaveNotice && <p role="status">{leaveNotice}</p>}
      {draftError && (
        <p className="form-message error" role="alert">
          {draftError}
        </p>
      )}
      {draftStatus === "error" && (
        <button
          type="button"
          className="text-button"
          disabled={pending || switchingDraft}
          onClick={() => void saveDraft()}
        >
          Retry draft save
        </button>
      )}
      {(draftStatus === "error" || draftStatus === "conflict") && (
        <button
          type="button"
          className="text-button"
          disabled={pending || switchingDraft}
          onClick={onDiscardLocalChanges}
        >
          Discard unsaved changes and close
        </button>
      )}
      {draftStatus === "conflict" && (
        <div>
          <button
            type="button"
            className="text-button"
            disabled={pending || switchingDraft}
            onClick={() => void reloadDraft()}
          >
            Reload saved draft
          </button>
          <button
            type="button"
            className="text-button"
            disabled={pending || switchingDraft}
            onClick={() => void overwriteDraft()}
          >
            Overwrite saved draft
          </button>
        </div>
      )}
      <p>
        Attachments are not saved with drafts and will not return after a
        reload.
      </p>
      <form onSubmit={submit} noValidate>
        {published ? (
          <p role="status">
            Post published. Retry any failed attachments, or view the post now.
          </p>
        ) : (
          <>
            <label>
              Post type
              <select
                value={type}
                disabled={archived || pending || switchingDraft || loadingDraft}
                onChange={(event) =>
                  setType(event.target.value as "question" | "note" | "poll")
                }
              >
                <option value="question">Question</option>
                <option value="note">Note</option>
                {staff && <option value="poll">Poll</option>}
              </select>
            </label>
            <label>
              Post title
              <textarea
                aria-label="Post title"
                className="post-title-input"
                rows={1}
                disabled={archived || pending || switchingDraft || loadingDraft}
                value={title.replace(/\r\n?/g, "\n")}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const caret = event.currentTarget.selectionStart;
                  setTitle((current) =>
                    editDraftMetadataText(current, value, caret),
                  );
                }}
                maxLength={
                  MAX_DRAFT_FIELD_LENGTH - (title.match(/\r\n/g)?.length ?? 0)
                }
                required
              />
            </label>
            <MarkdownEditorField
              key={editorGeneration}
              label="Post body"
              disabled={archived || pending || switchingDraft || loadingDraft}
              value={body}
              onChange={setBody}
              containerRef={bodyField}
            />
            {type === "poll" && (
              <fieldset className="poll-options-editor">
                <legend>Poll options</legend>
                {pollOptions.map((label, index) => (
                  <div key={index} className="poll-option-row">
                    <textarea
                      aria-label={`Option ${index + 1}`}
                      rows={1}
                      value={label.replace(/\r\n?/g, "\n")}
                      disabled={
                        archived || pending || switchingDraft || loadingDraft
                      }
                      maxLength={
                        MAX_DRAFT_FIELD_LENGTH -
                        (label.match(/\r\n/g)?.length ?? 0)
                      }
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        const caret = event.currentTarget.selectionStart;
                        setPollOptions((current) =>
                          current.map((option, position) =>
                            position === index
                              ? editDraftMetadataText(option, value, caret)
                              : option,
                          ),
                        );
                      }}
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Remove option ${index + 1}`}
                        disabled={
                          archived || pending || switchingDraft || loadingDraft
                        }
                        onClick={() =>
                          setPollOptions((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length < MAX_POLL_OPTIONS && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={
                      archived || pending || switchingDraft || loadingDraft
                    }
                    onClick={() =>
                      setPollOptions((current) => [...current, ""])
                    }
                  >
                    + Add option
                  </button>
                )}
              </fieldset>
            )}
            <label>
              Tags (comma-separated)
              <input
                value={tags}
                disabled={archived || pending || switchingDraft || loadingDraft}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
            {type !== "poll" && (
              <label>
                Post to
                <select
                  value={audience}
                  disabled={
                    archived || pending || switchingDraft || loadingDraft
                  }
                  onChange={(event) =>
                    setAudience(event.target.value as "course" | "staff")
                  }
                >
                  <option value="course">Entire class</option>
                  <option value="staff">Instructors and TAs</option>
                </select>
              </label>
            )}
            {staff && type === "note" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={announcement && audience !== "staff"}
                  disabled={
                    archived ||
                    pending ||
                    switchingDraft ||
                    audience === "staff"
                  }
                  onChange={(event) => setAnnouncement(event.target.checked)}
                />
                Post as announcement (pinned; email sent to subscribers)
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={
                  anonymous &&
                  !(type === "note" && announcement && audience !== "staff")
                }
                disabled={
                  archived ||
                  pending ||
                  switchingDraft ||
                  (type === "note" && announcement && audience !== "staff")
                }
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              Post anonymously
            </label>
          </>
        )}
        {!archived && (
          <AttachmentSelection
            queue={attachmentQueue}
            disabled={pending || switchingDraft}
          />
        )}
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={
            pending || switchingDraft || archived || draftStatus === "conflict"
          }
        >
          {pending
            ? "Publishing…"
            : published
              ? "Retry attachments"
              : "Publish post"}
        </button>
        {published && (
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => onCreated(published)}
          >
            View published post
          </button>
        )}
      </form>
      {type === "question" && query && (
        <div className="related-questions">
          <div className="section-title">
            <h3>Related questions</h3>
          </div>
          {suggestionsState === "loading" && (
            <p role="status">Finding related questions…</p>
          )}
          {suggestionsState === "error" && (
            <p role="alert">Related questions are unavailable.</p>
          )}
          {suggestionsState === "ready" &&
            (suggestions.length ? (
              <ul>
                {suggestions.map((post) => (
                  <li key={post.id}>
                    <a
                      href={postPath(courseId, post.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>{post.title}</strong>
                      <div className="post-card-preview post-markdown">
                        <PostBody bodyMarkdown={post.bodyMarkdown} inertLinks />
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No related questions found.</p>
            ))}
        </div>
      )}
    </section>
  );
}

function MergeControl({
  source,
  courseId,
  csrfToken,
  onBeforeMerge,
  onPendingChange,
  onMerged,
}: {
  source: Post;
  courseId: string;
  csrfToken: string;
  onBeforeMerge: () => boolean;
  onPendingChange: (pending: boolean) => void;
  onMerged: (targetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Post[]>([]);
  const [target, setTarget] = useState<Post>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !query.trim()) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void listPosts(courseId, {
        q: query.trim(),
        sort: "relevance",
        limit: 10,
        signal: controller.signal,
      })
        .then((page) =>
          setCandidates(page.data.filter((post) => post.id !== source.id)),
        )
        .catch(() => {
          if (!controller.signal.aborted)
            setError("Could not search canonical posts.");
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [courseId, open, query, source.id]);
  async function confirm() {
    if (!target || pending || !onBeforeMerge()) return;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      await confirmMergePost(source, target.id, csrfToken);
      onMerged(target.id);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }
  return (
    <div className="post-merge-control">
      <button
        type="button"
        className="button secondary compact"
        onClick={() => setOpen((value) => !value)}
      >
        Merge as duplicate
      </button>
      {open && (
        <div>
          <label>
            Find canonical post
            <input
              type="search"
              aria-label="Find canonical post"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setTarget(undefined);
                setCandidates([]);
              }}
            />
          </label>
          {candidates.length > 0 && (
            <ul>
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <a
                    href={postPath(courseId, candidate.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-button"
                    onClick={() => setTarget(candidate)}
                  >
                    {candidate.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {target && <p>Merge into {target.title}</p>}
          <button
            type="button"
            className="button primary"
            disabled={!target || pending}
            onClick={() => void confirm()}
          >
            Confirm merge
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

type DiscussionProps = {
  courseId: string;
  course?: Course;
  csrfToken: string;
  userId?: string;
  query?: string;
  postId?: string;
  onNavigate: (path: string) => void;
  onQueryChange?: (query: string) => void;
  /** Feed filters from the URL; without onFiltersChange the feed keeps its own. */
  filters?: FeedFilters;
  onFiltersChange?: (filters: FeedFilters) => void;
  onBeforeLeaveChange?: (guard: () => boolean) => void;
};

export function Discussion(props: DiscussionProps) {
  return <DiscussionContent key={props.courseId} {...props} />;
}

function PostEditor({
  post,
  csrfToken,
  onClose,
  onChanged,
  onStateChange,
}: {
  post: Post;
  csrfToken: string;
  onClose: () => void;
  onChanged: (post: Post) => void;
  onStateChange: (dirty: boolean, pending: boolean) => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.bodyMarkdown);
  const [tags, setTags] = useState(post.tags.join(", "));
  const [anonymous, setAnonymous] = useState(post.anonymous);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const queue = useAttachmentQueue();
  const draft = {
    title: title.trim(),
    bodyMarkdown: body,
    anonymous,
    tags: tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
  const payload = JSON.stringify(draft);
  const [savedPayload, setSavedPayload] = useState(payload);
  const latestPayload = useRef(payload);
  latestPayload.current = payload;
  const revision = useRef(post);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<Post>();
  const [filesAttempted, setFilesAttempted] = useState(false);
  const dirty = payload !== savedPayload || queue.files.length > 0;
  useEffect(() => {
    onStateChange(dirty, pending);
  }, [dirty, pending, onStateChange]);

  async function refresh() {
    const next = await getPost(post.id);
    if (
      "redirectToPostId" in next ||
      next.deleted ||
      next.courseId !== post.courseId ||
      next.duplicateStatus === "confirmed"
    )
      throw new Error(
        "This post is no longer editable. Your draft has been retained.",
      );
    revision.current = next;
    onChanged(next);
    return next;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || conflict) return;
    if (!draft.title || draft.title.length > 200) {
      setError("Post title must be between 1 and 200 characters.");
      return;
    }
    if (!draft.bodyMarkdown.trim() || draft.bodyMarkdown.length > 100000) {
      setError("Post body must be between 1 and 100,000 characters.");
      return;
    }
    if (draft.tags.length > 10 || draft.tags.some((tag) => tag.length > 40)) {
      setError("Use at most 10 tags of 40 characters each.");
      return;
    }
    setPending(true);
    setError("");
    setReview(undefined);
    try {
      if (payload !== savedPayload) {
        const saved = await updatePost(revision.current, draft, csrfToken);
        revision.current = saved;
        onChanged(saved);
        setSavedPayload(payload);
      }
      setFilesAttempted(queue.files.length > 0);
      const complete = await queue.upload(
        "post",
        post.id,
        csrfToken,
        async () => {
          await refresh();
        },
      );
      if (complete && latestPayload.current === payload) onClose();
    } catch (caught) {
      setError(message(caught));
      if (caught instanceof ApiError && caught.status === 412)
        setConflict(true);
    } finally {
      setPending(false);
    }
  }
  async function removeFile(id: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await deleteAttachment(id, csrfToken);
      await refresh();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  async function reviewLatest() {
    setPending(true);
    setError("");
    try {
      setReview(await refresh());
      setConflict(false);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="post-composer" aria-label="Edit post">
      <h2>Edit post</h2>
      <form onSubmit={submit} noValidate>
        <label>
          Post title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={201}
            required
          />
        </label>
        <MarkdownEditorField
          label="Post body"
          value={body}
          onChange={setBody}
        />
        <label>
          Tags (comma-separated)
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          Post anonymously
        </label>
        <AttachmentManager
          kind="post"
          parentId={post.id}
          attachments={post.attachments ?? []}
          canEdit={false}
          csrfToken={csrfToken}
          onChanged={() => {}}
        />
        {(post.attachments ?? []).map((file) => (
          <button
            key={file.id}
            type="button"
            className="text-button danger"
            disabled={pending}
            onClick={() => void removeFile(file.id)}
            aria-label={`Remove ${file.fileName}`}
          >
            Remove {file.fileName}
          </button>
        ))}
        <AttachmentSelection
          queue={queue}
          disabled={pending}
          existingCount={post.attachments?.length ?? 0}
        />
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <>
            <p>
              Your draft is intact. Review the latest post before saving again.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={() => void reviewLatest()}
            >
              Review latest post
            </button>
          </>
        )}
        {review && (
          <section aria-label="Latest saved post">
            <h3>{review.title}</h3>
            <PostBody bodyMarkdown={review.bodyMarkdown} />
            <p>
              Tags: {review.tags.join(", ")} ·{" "}
              {review.anonymous ? "Anonymous" : "Named"}
            </p>
            <p>
              Latest saved version loaded. Compare it with your draft before
              saving again.
            </p>
          </section>
        )}
        <button
          type="submit"
          className="button primary"
          disabled={pending || conflict}
        >
          {pending
            ? "Saving…"
            : filesAttempted &&
                payload === savedPayload &&
                queue.files.length > 0
              ? "Retry attachments"
              : "Save post"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={pending}
          onClick={onClose}
        >
          Cancel editing
        </button>
      </form>
    </section>
  );
}

function DiscussionContent({
  courseId,
  course: sharedCourse,
  csrfToken,
  userId,
  query,
  postId,
  onNavigate,
  onQueryChange,
  filters: routeFilters,
  onFiltersChange,
  onBeforeLeaveChange,
}: DiscussionProps) {
  const [localCourse, setCourse] = useState<Course>();
  const course = sharedCourse ?? localCourse;
  const [courseError, setCourseError] = useState("");
  const [draftQuery, setDraftQuery] = useState(query ?? "");
  const [items, setItems] = useState<Post[]>([]);
  const [mergedItems, setMergedItems] = useState<MergedPost[]>([]);
  const [staff, setStaff] = useState(false);
  const [role, setRole] = useState<"student" | "ta" | "instructor">();
  const [postView, setPostView] = useState<"posts" | "duplicates">("posts");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [tagLimitReached, setTagLimitReached] = useState(false);
  const [openSections, setOpenSections] = useState(() => {
    const open = initiallyOpen();
    return { show: open, sort: open, tags: open };
  });
  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }
  const [desktopFilters, setDesktopFilters] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 851px)").matches,
  );
  const [localFilters, setLocalFilters] = useState<FeedFilters>({});
  // Locally, a chosen sort belongs to the search it was chosen for; the URL drops it on a new search.
  const [localSortQuery, setLocalSortQuery] = useState<string>();
  const [pinPending, setPinPending] = useState(false);
  const [pinError, setPinError] = useState("");
  const [readError, setReadError] = useState("");
  const [detailCycle, setDetailCycle] = useState(0);
  const [reviewError, setReviewError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [pageError, setPageError] = useState("");
  const [pagePending, setPagePending] = useState(false);
  const [feedCycle, setFeedCycle] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detail, setDetail] = useState<PostDetail>();
  const [detailError, setDetailError] = useState("");
  const canEditDetail =
    !!detail &&
    !detail.deleted &&
    course?.status === "active" &&
    !!role &&
    detail.duplicateStatus !== "confirmed" &&
    (staff || (!!userId && detail.author.userId === userId));
  const [editingPostId, setEditingPostId] = useState<string>();
  const [postSessions, setPostSessions] = useState<{
    postId: string;
    sessions: CodeSession[];
  }>();
  const [mergePending, setMergePending] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
  const [reviewDetail, setReviewDetail] = useState<Post>();
  const [reviewDetailError, setReviewDetailError] = useState("");
  const [composerSeed, setComposerSeed] = useState<{
    title: string;
    id: number;
  }>();
  const composerState = useRef({ dirty: false, pending: false });
  const composerLeaveRequest = useRef<() => boolean>(() => true);
  const editorState = useRef({ dirty: false, pending: false });
  const listScroll = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const viewport = window.matchMedia("(min-width: 851px)");
    const update = () => setDesktopFilters(viewport.matches);
    viewport.addEventListener("change", update);
    update();
    return () => viewport.removeEventListener("change", update);
  }, []);
  // "/" focuses search unless the reader is typing somewhere.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest('[contenteditable="true"]') ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      )
        return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);
  const lastRequestedQuery = useRef<string | undefined>(undefined);
  const pageBusy = useRef(false);
  const currentFeed = useRef(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void getMembership(courseId, userId)
      .then(({ data }) => {
        if (!active) return;
        setRole(data.role);
        setStaff(data.role === "ta" || data.role === "instructor");
      })
      .catch(() => {
        if (active) setStaff(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, userId]);

  useEffect(() => {
    if (sharedCourse) return;
    let active = true;
    setCourse(undefined);
    setCourseError("");
    void getCourse(courseId)
      .then((result) => {
        if (active) setCourse(result.data);
      })
      .catch((caught) => {
        if (active) setCourseError(message(caught));
      });
    return () => {
      active = false;
    };
  }, [courseId, sharedCourse]);
  useEffect(() => {
    const incoming = query ?? "";
    const ownUpdate = incoming === lastRequestedQuery.current;
    lastRequestedQuery.current = undefined;
    setDraftQuery((current) =>
      ownUpdate && current.trim() !== incoming ? current : incoming,
    );
  }, [query]);
  useEffect(() => {
    const next = draftQuery.trim();
    if (!next || next === (query ?? "")) return;
    const timer = window.setTimeout(() => {
      lastRequestedQuery.current = next;
      onQueryChange?.(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery, onQueryChange, query]);
  const activeFilters = onFiltersChange ? (routeFilters ?? {}) : localFilters;
  function changeFilters(next: FeedFilters) {
    if (onFiltersChange) onFiltersChange(next);
    else setLocalFilters(next);
  }
  const filterOptions = feedFilters(userId, staff);
  const activeFilter = filterOptions.find(
    (item) => item.key === activeFilters.filter,
  );
  const filter = activeFilter?.key ?? "all";
  // Filters may arrive as fresh objects on each render, so tags keep their identity by content.
  const tagKey = JSON.stringify([
    activeFilters.tags ?? [],
    activeFilters.tagMatch ?? null,
  ]);
  const [tags, tagMatch] = useMemo(() => {
    const [list, match] = JSON.parse(tagKey) as [string[], "any" | null];
    return [list, match ?? undefined] as const;
  }, [tagKey]);
  const chosenSort =
    onFiltersChange || localSortQuery === query
      ? activeFilters.sort
      : undefined;
  const sort: PostSort =
    chosenSort && (query || chosenSort !== "relevance")
      ? chosenSort
      : query
        ? "relevance"
        : "recent_activity";
  const search = feedSearch(query, activeFilters);
  const searchRef = useRef(search);
  searchRef.current = search;
  function changeTags(nextTags: string[]) {
    const next = { ...activeFilters };
    if (nextTags.length) next.tags = nextTags;
    else delete next.tags;
    if (nextTags.length < 2) delete next.tagMatch;
    setTagLimitReached(false);
    changeFilters(next);
  }
  /** A tag chip adds its tag, or removes it when it is already active. */
  function selectTag(next: string) {
    if (hasTag(tags, next))
      changeTags(
        tags.filter((tag) => tag.toLowerCase() !== next.toLowerCase()),
      );
    else if (tags.length >= MAX_FEED_TAGS) setTagLimitReached(true);
    else changeTags([...tags, next]);
  }
  useEffect(() => {
    const generation = ++currentFeed.current;
    const controller = new AbortController();
    setItems([]);
    setMergedItems([]);
    setCursor(null);
    setFeedError("");
    setPageError("");
    setLoading(true);
    setPagePending(false);
    pageBusy.current = false;
    const options = {
      ...(postView === "duplicates"
        ? query
          ? { q: query, sort: "relevance" as const }
          : {}
        : feedOptions(
            query,
            // `filter` already falls back to all posts for students.
            feedFilters(userId, true).find((item) => item.key === filter),
            sort,
            tags,
            tagMatch,
          )),
      signal: controller.signal,
    };
    void (
      postView === "duplicates"
        ? listMergedPosts(courseId, options)
        : listPosts(courseId, options)
    )
      .then((page) => {
        if (currentFeed.current === generation) {
          if (postView === "duplicates")
            setMergedItems(page.data as MergedPost[]);
          else setItems(page.data as Post[]);
          setCursor(page.page.nextCursor);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (currentFeed.current === generation) {
          setFeedError(message(caught));
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      if (currentFeed.current === generation)
        currentFeed.current = generation + 1;
    };
  }, [
    courseId,
    query,
    feedCycle,
    postView,
    filter,
    sort,
    tags,
    tagMatch,
    userId,
  ]);
  useEffect(() => {
    if (!postId) {
      setDetail(undefined);
      setDetailError("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setDetail(undefined);
    setDetailError("");
    void getPost(postId, controller.signal)
      .then((next) => {
        if (active) {
          if ("redirectToPostId" in next)
            onNavigate(
              postPath(courseId, next.redirectToPostId, searchRef.current),
            );
          else if (next.courseId !== courseId)
            setDetailError("This post is unavailable.");
          else setDetail(next);
        }
      })
      .catch(() => {
        if (active) setDetailError("This post is unavailable.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [courseId, onNavigate, postId, detailCycle]);
  useEffect(() => {
    if (!listScroll.current) return;
    if (postId || composerOpen) window.scrollTo(0, 0);
    else {
      window.scrollTo(0, listScroll.current);
      listScroll.current = 0;
    }
  }, [postId, composerOpen]);

  useEffect(() => {
    if (postView !== "duplicates" || !selectedReviewId) return;
    let active = true;
    const controller = new AbortController();
    setReviewDetail(undefined);
    setReviewDetailError("");
    void getDuplicateReview(selectedReviewId, controller.signal)
      .then((next) => {
        if (active) {
          if (
            next.courseId === courseId &&
            next.duplicateStatus === "confirmed"
          )
            setReviewDetail(next);
          else setReviewDetailError("This duplicate is unavailable.");
        }
      })
      .catch(() => {
        if (active) setReviewDetailError("This duplicate is unavailable.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [courseId, postView, selectedReviewId]);

  function loadMore() {
    if (!cursor || pageBusy.current) return;
    pageBusy.current = true;
    setPagePending(true);
    setPageError("");
    const generation = currentFeed.current;
    const options = {
      ...(postView === "duplicates"
        ? query
          ? { q: query, sort: "relevance" as const }
          : {}
        : feedOptions(query, activeFilter, sort, tags, tagMatch)),
      cursor,
    };
    void (
      postView === "duplicates"
        ? listMergedPosts(courseId, options)
        : listPosts(courseId, options)
    )
      .then((page) => {
        if (generation !== currentFeed.current) return;
        if (postView === "duplicates")
          setMergedItems((prior) => {
            const known = new Set(prior.map((post) => post.id));
            return [
              ...prior,
              ...(page.data as MergedPost[]).filter(
                (post) => !known.has(post.id),
              ),
            ];
          });
        else
          setItems((prior) => {
            const known = new Set(prior.map((post) => post.id));
            return [
              ...prior,
              ...(page.data as Post[]).filter((post) => !known.has(post.id)),
            ];
          });
        setCursor(page.page.nextCursor);
      })
      .catch((caught) => {
        if (generation !== currentFeed.current) return;
        if (
          caught instanceof ApiError &&
          caught.status === 409 &&
          caught.code === "search_restart_required"
        )
          setFeedCycle((current) => current + 1);
        else setPageError(message(caught));
      })
      .finally(() => {
        if (generation === currentFeed.current) {
          pageBusy.current = false;
          setPagePending(false);
        }
      });
  }
  function leaveComposer() {
    if (mergePending) return false;
    if (editingPostId) {
      if (editorState.current.pending) return false;
      if (
        editorState.current.dirty &&
        !window.confirm("Discard your unsaved post edits?")
      )
        return false;
      editorState.current = { dirty: false, pending: false };
      setEditingPostId(undefined);
    }
    if (!composerOpen) return true;
    if (composerState.current.pending) return false;
    if (!composerLeaveRequest.current()) return false;
    if (
      composerState.current.dirty &&
      !window.confirm("Discard queued attachments before leaving?")
    )
      return false;
    composerState.current = { dirty: false, pending: false };
    setComposerOpen(false);
    return true;
  }
  function beforeMerge() {
    if (editorState.current.pending || composerState.current.pending)
      return false;
    if (editingPostId && editorState.current.dirty)
      return window.confirm("Discard your unsaved post edits?");
    return true;
  }
  // The route shell consults the same guard used by post navigation.
  useEffect(() => {
    onBeforeLeaveChange?.(leaveComposer);
  });
  useEffect(
    () => () => onBeforeLeaveChange?.(() => true),
    [onBeforeLeaveChange],
  );
  function navigate(path: string) {
    if (leaveComposer()) onNavigate(path);
  }
  function openPost(id: string) {
    if (!postId && !composerOpen) listScroll.current = window.scrollY;
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.unread ? { ...item, unread: false } : item,
      ),
    );
    navigate(postPath(courseId, id, search));
  }
  function clearQuery() {
    setDraftQuery("");
    if (query) {
      lastRequestedQuery.current = "";
      onQueryChange?.("");
    }
  }
  function clearSearch() {
    clearQuery();
    searchInput.current?.focus();
  }
  function clearSearchAndFilters() {
    clearQuery();
    changeFilters({});
  }
  function openComposer(title?: string) {
    if (composerOpen && !title) return;
    if ((composerOpen || editingPostId) && !leaveComposer()) return;
    if (!postId && !composerOpen) listScroll.current = window.scrollY;
    setComposerSeed(title ? { title, id: Date.now() } : undefined);
    setComposerOpen(true);
  }
  const askOffer =
    query && postView === "posts" && course?.status === "active" ? (
      <button
        type="button"
        className="button secondary ask-button"
        onClick={() => openComposer(query.slice(0, 200))}
      >
        Ask “{query.length > 60 ? `${query.slice(0, 60)}…` : query}” as a new
        question
      </button>
    ) : null;
  // Answering or posting a followup follows the post unless the viewer
  // unfollowed it, and followup activity changes the unresolved count.
  async function refreshFollowing(id: string) {
    try {
      const next = await getPost(id);
      if ("redirectToPostId" in next || next.deleted) return;
      const state = {
        following: next.following,
        unresolvedFollowups: next.unresolvedFollowups,
      };
      setDetail((current) =>
        current?.id === id && !current.deleted
          ? { ...current, ...state }
          : current,
      );
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...state } : item)),
      );
    } catch {
      // The button and count keep their last known state.
    }
  }
  const courseMentions = useCallback(
    (query: string) => mentionSuggestions(courseId, query),
    [courseId],
  );
  const postMentions = useCallback(
    (query: string) => mentionSuggestions(courseId, query, postId),
    [courseId, postId],
  );
  async function markAllRead() {
    setReadError("");
    try {
      await markCourseRead(courseId, csrfToken);
      setItems((current) =>
        current.map((item) =>
          item.unread ? { ...item, unread: false } : item,
        ),
      );
    } catch (caught) {
      setReadError(message(caught));
    }
  }
  async function togglePin(post: Post) {
    if (pinPending) return;
    setPinPending(true);
    setPinError("");
    try {
      const next = await setPostPinned(post, !post.pinned, csrfToken);
      setDetail(next);
      setFeedCycle((value) => value + 1);
    } catch (caught) {
      setPinError(message(caught));
      setDetailCycle((value) => value + 1);
    } finally {
      setPinPending(false);
    }
  }
  async function unmerge(post: MergedPost) {
    setReviewError("");
    try {
      await unmergePost(
        reviewDetail?.id === post.id
          ? { ...post, version: reviewDetail.version }
          : post,
        csrfToken,
      );
      setMergedItems((prior) => prior.filter((item) => item.id !== post.id));
      if (selectedReviewId === post.id) {
        setSelectedReviewId(undefined);
        setReviewDetail(undefined);
      }
      setFeedCycle((value) => value + 1);
    } catch (caught) {
      setReviewError(message(caught));
    }
  }
  return (
    <MentionContext.Provider value={postMentions}>
      <section
        className={sharedCourse ? "discussion-body" : "discussion-shell"}
      >
        {!sharedCourse && (
          <header className="discussion-header">
            <div>
              <button className="text-button" onClick={() => navigate("/home")}>
                ← All courses
              </button>
              <h1>{course?.name ?? "Course discussion"}</h1>
            </div>
            <nav aria-label="Course navigation">
              <a
                href={discussionPath(courseId)}
                aria-current="page"
                onClick={(event) => {
                  if (!leaveComposer()) event.preventDefault();
                }}
              >
                Discussion
              </a>
              <a
                href={`/courses/${encodeURIComponent(courseId)}/settings`}
                onClick={(event) => {
                  if (!leaveComposer()) event.preventDefault();
                }}
              >
                Course settings
              </a>
            </nav>
          </header>
        )}
        {courseError && <p role="alert">{courseError}</p>}
        <CourseLiveSessions
          courseId={courseId}
          staff={staff}
          onOpen={(sessionCourseId, sessionId) =>
            navigate(sessionRoute(sessionCourseId, sessionId))
          }
        />
        <div
          className={`discussion-columns${postId || selectedReviewId || composerOpen ? " has-selection" : ""}${desktopFilters && filtersCollapsed ? " filters-collapsed" : ""}`}
        >
          <aside
            id="post-filters"
            className="discussion-sidebar"
            aria-label="Post filters"
            aria-hidden={desktopFilters && filtersCollapsed ? true : undefined}
            inert={desktopFilters && filtersCollapsed}
          >
            <FilterSection
              name="Show"
              summary={
                activeFilter?.ariaLabel ?? activeFilter?.label ?? "All posts"
              }
              open={openSections.show}
              onToggle={() => toggleSection("show")}
            >
              <ChoiceGroup
                name="Show"
                value={filter}
                disabled={postView === "duplicates"}
                choices={filterOptions.map((item) => ({
                  value: item.key,
                  label: item.ariaLabel ?? item.label,
                  nested: item.nested,
                }))}
                onChange={(key) => {
                  const next = { ...activeFilters };
                  if (key === "all") delete next.filter;
                  else next.filter = key;
                  changeFilters(next);
                }}
              />
            </FilterSection>
            <FilterSection
              name="Sort by"
              summary={SORT_LABELS[sort]}
              open={openSections.sort}
              onToggle={() => toggleSection("sort")}
            >
              <ChoiceGroup
                name="Sort by"
                value={sort}
                disabled={postView === "duplicates"}
                choices={(query ? SORTS : SORTS.slice(1)).map((value) => ({
                  value,
                  label: SORT_LABELS[value],
                }))}
                onChange={(value) => {
                  if (!onFiltersChange) setLocalSortQuery(query);
                  changeFilters({ ...activeFilters, sort: value as PostSort });
                }}
              />
            </FilterSection>
            {tags.length > 0 && (
              <FilterSection
                name="Tags"
                summary={String(tags.length)}
                open={openSections.tags}
                onToggle={() => toggleSection("tags")}
              >
                <ul className="active-tags" aria-label="Active tags">
                  {tags.map((tag) => (
                    <li key={tag}>
                      <button
                        type="button"
                        className="tag-chip active"
                        aria-label={`Remove tag filter ${tag}`}
                        disabled={postView === "duplicates"}
                        onClick={() =>
                          changeTags(tags.filter((item) => item !== tag))
                        }
                      >
                        #{tag}
                        <span aria-hidden="true"> ×</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {tags.length > 1 && (
                  <ChoiceGroup
                    name="Match"
                    showLegend
                    className="tag-match"
                    value={tagMatch ?? "all"}
                    disabled={postView === "duplicates"}
                    choices={[
                      { value: "any", label: "Any" },
                      { value: "all", label: "All" },
                    ]}
                    onChange={(value) => {
                      const next = { ...activeFilters };
                      if (value === "any") next.tagMatch = "any";
                      else delete next.tagMatch;
                      changeFilters(next);
                    }}
                  />
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={postView === "duplicates"}
                  onClick={() => changeTags([])}
                >
                  Clear all
                </button>
              </FilterSection>
            )}
            <p role="status" className="tag-limit">
              {tagLimitReached
                ? `At most ${MAX_FEED_TAGS} tags can be combined.`
                : ""}
            </p>
          </aside>
          {desktopFilters && (
            <button
              type="button"
              className="filter-collapse-toggle"
              aria-label={
                filtersCollapsed ? "Expand filters" : "Collapse filters"
              }
              aria-controls="post-filters"
              aria-expanded={!filtersCollapsed}
              onClick={() => setFiltersCollapsed((collapsed) => !collapsed)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {filtersCollapsed ? (
                  <>
                    <path d="m6 7 5 5-5 5" />
                    <path d="m12 7 5 5-5 5" />
                  </>
                ) : (
                  <>
                    <path d="m12 7-5 5 5 5" />
                    <path d="m18 7-5 5 5 5" />
                  </>
                )}
              </svg>
            </button>
          )}
          <section className="discussion-feed" aria-label="Posts">
            {staff && (
              <div
                className="post-view-picker"
                role="group"
                aria-label="Post view"
              >
                <div className="post-view-segments">
                  {(
                    [
                      ["posts", "Active"],
                      ["duplicates", "Duplicate"],
                    ] as const
                  ).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={postView === view}
                      onClick={() => {
                        if (view !== postView && !leaveComposer()) return;
                        setSelectedReviewId(undefined);
                        setReviewDetail(undefined);
                        setReviewDetailError("");
                        setPostView(view);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="discussion-toolbar">
              <div role="search" className="search-field">
                <label className="visually-hidden" htmlFor="post-search">
                  Search posts
                </label>
                <input
                  ref={searchInput}
                  id="post-search"
                  type="search"
                  aria-describedby="post-search-help"
                  value={draftQuery}
                  maxLength={500}
                  onChange={(event) => {
                    const next = event.target.value.slice(0, 500);
                    setDraftQuery(next);
                    if (!next.trim() && query) {
                      lastRequestedQuery.current = "";
                      onQueryChange?.("");
                    }
                  }}
                  placeholder="Search posts"
                />
                {draftQuery && (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="button primary create-post"
                disabled={!course || course.status === "deleting"}
                onClick={() => openComposer()}
                aria-label={
                  course?.status === "archived"
                    ? "View saved draft"
                    : "Create post"
                }
              >
                {course?.status === "archived"
                  ? "View saved draft"
                  : "+ Create post"}
              </button>
            </div>
            <p id="post-search-help" className="visually-hidden">
              Search words, "quoted phrases", OR, or -excluded terms.
            </p>
            {reviewError && <p role="alert">{reviewError}</p>}
            <div
              className="post-list-scroll"
              role="region"
              aria-label="Post listings"
              tabIndex={0}
            >
              {loading ? (
                <p role="status">Loading posts…</p>
              ) : feedError ? (
                <>
                  <p role="alert">{feedError}</p>
                  <button
                    className="text-button"
                    onClick={() => setFeedCycle((value) => value + 1)}
                  >
                    Try again
                  </button>
                </>
              ) : postView === "duplicates" ? (
                mergedItems.length ? (
                  <ul className="post-list">
                    {mergedItems.map((post) => (
                      <li key={post.id}>
                        <div
                          className={`post-card${post.id === selectedReviewId ? " selected" : ""}`}
                        >
                          <button
                            type="button"
                            className="post-card-title-button"
                            aria-label={post.title}
                            aria-current={
                              post.id === selectedReviewId ? "true" : undefined
                            }
                            onClick={() => {
                              setSelectedReviewId(post.id);
                              setReviewDetail(undefined);
                              setReviewDetailError("");
                            }}
                          >
                            <strong>{post.title}</strong>
                          </button>
                          <span>
                            Merged into{" "}
                            <a
                              href={postPath(courseId, post.duplicateOfPostId)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {post.canonicalTitle}
                            </a>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No duplicate posts found.</p>
                )
              ) : items.length ? (
                <>
                  {items.some((item) => item.unread && item.id !== postId) && (
                    <div className="feed-read-bar">
                      <span>
                        {
                          items.filter(
                            (item) => item.unread && item.id !== postId,
                          ).length
                        }{" "}
                        unread
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void markAllRead()}
                      >
                        Mark all read
                      </button>
                    </div>
                  )}
                  {readError && (
                    <p className="form-message error" role="alert">
                      {readError}
                    </p>
                  )}
                  <ul className="post-list">
                    {items.map((post) => (
                      <li
                        key={post.id}
                        className={post.id === postId ? "selected" : undefined}
                      >
                        <a
                          className={`post-card${post.id === postId ? " selected" : ""}${post.unread && post.id !== postId ? " unread" : ""}`}
                          href={postPath(courseId, post.id, search)}
                          onClick={(event) => {
                            event.preventDefault();
                            openPost(post.id);
                          }}
                          aria-current={post.id === postId ? "page" : undefined}
                        >
                          <span className="post-card-head">
                            <span className="post-card-title">
                              {post.unread && post.id !== postId && (
                                <span className="unread-dot">
                                  <span className="visually-hidden">
                                    Unread:{" "}
                                  </span>
                                </span>
                              )}
                              <PostTypeBadge type={post.type} />
                              <strong>{post.title}</strong>
                            </span>
                            {postStatuses(post).length > 0 && (
                              <span className="post-statuses">
                                {postStatuses(post).map((status) => (
                                  <PostStatusBadge
                                    key={status.label}
                                    status={status}
                                  />
                                ))}
                              </span>
                            )}
                          </span>
                          <div className="post-card-preview post-markdown">
                            <PostBody
                              bodyMarkdown={post.bodyMarkdown}
                              inertLinks
                            />
                          </div>
                          <span className="post-card-foot">
                            <small>
                              <PostByline post={post} />
                            </small>
                            {postTypeOf(post.type).extras?.(post) && (
                              <span className="post-card-extras">
                                {postTypeOf(post.type).extras?.(post)}
                              </span>
                            )}
                          </span>
                        </a>
                        <TagList
                          tags={post.tags}
                          active={tags}
                          onSelect={selectTag}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              ) : query || hasFilters(activeFilters) ? (
                <div className="feed-empty">
                  <p>No posts found.</p>
                  <p>Nothing matches this search or these filters.</p>
                  {askOffer}
                  <button
                    type="button"
                    className="text-button"
                    onClick={clearSearchAndFilters}
                  >
                    Clear search and filters
                  </button>
                </div>
              ) : (
                <div className="feed-empty">
                  <p>No posts yet.</p>
                  <p>Start the discussion with a question or note.</p>
                </div>
              )}
              {cursor && !loading && (
                <>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={pagePending}
                    onClick={loadMore}
                  >
                    {pagePending
                      ? "Loading more posts…"
                      : pageError
                        ? "Retry loading posts"
                        : "Load more posts"}
                  </button>
                  {pageError && <p role="alert">{pageError}</p>}
                </>
              )}
              {items.length > 0 && !loading && !feedError && askOffer && (
                <div className="ask-footer">
                  <p>Didn’t find what you need?</p>
                  {askOffer}
                </div>
              )}
            </div>
          </section>
          <section
            className="discussion-detail"
            aria-label="Post detail"
            tabIndex={0}
          >
            <div className="discussion-detail-content">
              {composerOpen ? (
                <>
                  <button
                    type="button"
                    className="text-button narrow-back"
                    onClick={() => {
                      if (leaveComposer() && postId)
                        onNavigate(discussionPath(courseId, search));
                    }}
                  >
                    ← Back to posts
                  </button>
                  <MentionContext.Provider value={courseMentions}>
                    <Composer
                      key={composerSeed?.id ?? 0}
                      initialTitle={composerSeed?.title}
                      courseId={courseId}
                      csrfToken={csrfToken}
                      staff={staff}
                      archived={course?.status !== "active"}
                      onClose={leaveComposer}
                      onDiscardLocalChanges={() => {
                        if (
                          composerState.current.dirty &&
                          !window.confirm(
                            "Discard queued attachments before leaving?",
                          )
                        )
                          return;
                        composerState.current = {
                          dirty: false,
                          pending: false,
                        };
                        composerLeaveRequest.current = () => true;
                        setComposerOpen(false);
                      }}
                      onLeaveRequestChange={(guard) => {
                        composerLeaveRequest.current = guard;
                      }}
                      onStateChange={(dirty, pending) => {
                        composerState.current = { dirty, pending };
                      }}
                      onCreated={(post) => {
                        composerState.current = {
                          dirty: false,
                          pending: false,
                        };
                        setComposerOpen(false);
                        setFeedCycle((value) => value + 1);
                        onNavigate(postPath(courseId, post.id, search));
                      }}
                    />
                  </MentionContext.Provider>
                </>
              ) : postView === "duplicates" ? (
                selectedReviewId ? (
                  reviewDetailError ? (
                    <p role="alert">{reviewDetailError}</p>
                  ) : !reviewDetail || reviewDetail.id !== selectedReviewId ? (
                    <p role="status">Loading duplicate…</p>
                  ) : (
                    <article>
                      <p className="post-kind">
                        {postTypeOf(reviewDetail.type).label}
                      </p>
                      <h2>{reviewDetail.title}</h2>
                      <p className="post-author">
                        <PostByline post={reviewDetail} />
                      </p>
                      <div className="post-markdown">
                        <PostBody bodyMarkdown={reviewDetail.bodyMarkdown} />
                      </div>
                      {reviewDetail.tags.length > 0 && (
                        <p>Tags: {reviewDetail.tags.join(", ")}</p>
                      )}
                      <p>
                        Merged into{" "}
                        <a
                          href={postPath(
                            courseId,
                            reviewDetail.duplicateOfPostId!,
                          )}
                          onClick={(event) => {
                            event.preventDefault();
                            setSelectedReviewId(undefined);
                            setReviewDetail(undefined);
                            setPostView("posts");
                            navigate(
                              postPath(
                                courseId,
                                reviewDetail.duplicateOfPostId!,
                              ),
                            );
                          }}
                        >
                          {mergedItems.find(
                            (item) => item.id === selectedReviewId,
                          )?.canonicalTitle ?? "Canonical post"}
                        </a>
                      </p>
                      {mergedItems.find(
                        (item) => item.id === selectedReviewId,
                      ) && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() =>
                            void unmerge(
                              mergedItems.find(
                                (item) => item.id === selectedReviewId,
                              )!,
                            )
                          }
                          aria-label={`Unmerge ${reviewDetail.title}`}
                        >
                          Unmerge
                        </button>
                      )}
                    </article>
                  )
                ) : (
                  <div className="detail-prompt">
                    <h2>Select a duplicate post</h2>
                    <p>Choose a duplicate to review it here.</p>
                  </div>
                )
              ) : postId ? (
                <>
                  <button
                    className="text-button narrow-back"
                    onClick={() => navigate(discussionPath(courseId, search))}
                  >
                    ← Back to posts
                  </button>
                  {detailError ? (
                    <p role="alert">{detailError}</p>
                  ) : !detail ||
                    detail.id !== postId ||
                    detail.courseId !== courseId ? (
                    <p role="status">Loading post…</p>
                  ) : detail.deleted ? (
                    <p>This post was deleted.</p>
                  ) : (
                    <article>
                      {canEditDetail && editingPostId === detail.id && (
                        <div inert={mergePending}>
                          <PostEditor
                            key={detail.id}
                            post={detail}
                            csrfToken={csrfToken}
                            onClose={() => setEditingPostId(undefined)}
                            onChanged={(next) => {
                              setDetail(next);
                              setItems((current) =>
                                current.map((item) =>
                                  item.id === next.id ? next : item,
                                ),
                              );
                            }}
                            onStateChange={(dirty, pending) => {
                              editorState.current = { dirty, pending };
                            }}
                          />
                        </div>
                      )}
                      {(editingPostId !== detail.id || !canEditDetail) && (
                        <>
                          <p className="post-kind">
                            {postTypeOf(detail.type).label}
                          </p>
                          <h2>{detail.title}</h2>
                          {detail.private && (
                            <PrivateNotice
                              post={detail}
                              own={detail.author.userId === userId}
                              canPublish={
                                course?.status === "active" &&
                                (staff || detail.author.userId === userId)
                              }
                              csrfToken={csrfToken}
                              onPublished={(next) => {
                                setDetail(next);
                                setItems((current) =>
                                  current.map((item) =>
                                    item.id === next.id ? next : item,
                                  ),
                                );
                              }}
                            />
                          )}
                          <div className="post-author-row">
                            <p className="post-author">
                              <PostByline post={detail} />
                              <ActivityTime post={detail} />
                            </p>
                            <FollowButton
                              post={detail}
                              csrfToken={csrfToken}
                              onChange={(following) => {
                                setDetail((current) =>
                                  current?.id === detail.id && !current.deleted
                                    ? { ...current, following }
                                    : current,
                                );
                                setItems((current) =>
                                  current.map((item) =>
                                    item.id === detail.id
                                      ? { ...item, following }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          </div>
                          <TagList
                            tags={detail.tags}
                            active={tags}
                            onSelect={selectTag}
                          />
                          {postView === "posts" && (
                            <ActiveSessionLink
                              sessions={
                                postSessions?.postId === detail.id
                                  ? postSessions.sessions
                                  : undefined
                              }
                              onOpen={(sessionId) =>
                                navigate(sessionRoute(courseId, sessionId))
                              }
                            />
                          )}
                          <div className="post-markdown">
                            <PostBody bodyMarkdown={detail.bodyMarkdown} />
                            {detail.type === "poll" && detail.options && (
                              <PollCard
                                key={detail.id}
                                postId={detail.id}
                                options={detail.options}
                                totalVotes={detail.totalVotes ?? 0}
                                closed={course?.status !== "active"}
                                csrfToken={csrfToken}
                                onChange={(state) => {
                                  setDetail((current) =>
                                    current?.id === detail.id &&
                                    !current.deleted
                                      ? { ...current, ...state }
                                      : current,
                                  );
                                  setItems((current) =>
                                    current.map((item) =>
                                      item.id === detail.id
                                        ? { ...item, ...state }
                                        : item,
                                    ),
                                  );
                                }}
                              />
                            )}
                            <AttachmentManager
                              kind="post"
                              parentId={detail.id}
                              attachments={detail.attachments ?? []}
                              canEdit={false}
                              csrfToken={csrfToken}
                              onChanged={async () => {
                                const next = await getPost(detail.id);
                                if ("redirectToPostId" in next) {
                                  setDetailCycle((value) => value + 1);
                                  return;
                                }
                                if (next.courseId !== courseId)
                                  throw new Error("This post is unavailable.");
                                setDetail((current) =>
                                  current?.id === next.id &&
                                  (next.deleted ||
                                    current.deleted ||
                                    next.version >= current.version)
                                    ? next
                                    : current,
                                );
                              }}
                            />
                          </div>
                          {canEditDetail && (
                            <button
                              type="button"
                              className="button secondary edit-button"
                              disabled={mergePending}
                              onClick={() => setEditingPostId(detail.id)}
                            >
                              Edit post
                            </button>
                          )}
                        </>
                      )}
                      {staff && postView === "posts" && (
                        <div
                          className="staff-actions"
                          role="group"
                          aria-label="Staff actions"
                        >
                          {course?.status === "active" && (
                            <button
                              type="button"
                              className="button secondary compact"
                              disabled={pinPending}
                              onClick={() => void togglePin(detail)}
                            >
                              {pinPending
                                ? detail.pinned
                                  ? "Unpinning…"
                                  : "Pinning…"
                                : detail.pinned
                                  ? "Unpin"
                                  : "Pin"}
                            </button>
                          )}
                          {pinError && (
                            <p className="form-message error" role="alert">
                              {pinError}
                            </p>
                          )}
                          <MergeControl
                            source={detail}
                            courseId={courseId}
                            csrfToken={csrfToken}
                            onBeforeMerge={beforeMerge}
                            onPendingChange={setMergePending}
                            onMerged={(targetId) => {
                              editorState.current = {
                                dirty: false,
                                pending: false,
                              };
                              setEditingPostId(undefined);
                              setFeedCycle((value) => value + 1);
                              onNavigate(postPath(courseId, targetId, search));
                            }}
                          />
                        </div>
                      )}
                      {detail.type === "question" && (
                        <QuestionResponses
                          postId={detail.id}
                          role={role}
                          courseStatus={course?.status}
                          csrfToken={csrfToken}
                          onActivity={() => void refreshFollowing(detail.id)}
                        />
                      )}
                      {postView === "posts" && (
                        <SessionsPanel
                          courseId={courseId}
                          postId={detail.id}
                          tags={detail.tags}
                          onLoaded={(sessions) =>
                            setPostSessions({ postId: detail.id, sessions })
                          }
                          courseStatus={course?.status}
                          csrfToken={csrfToken}
                          onOpen={(sessionId) =>
                            navigate(sessionRoute(courseId, sessionId))
                          }
                        />
                      )}
                    </article>
                  )}
                </>
              ) : (
                <div className="detail-prompt">
                  <h2>Select a post</h2>
                  <p>Choose a post to read it here.</p>
                  {course?.status === "active" && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => openComposer()}
                    >
                      Start a new post
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </MentionContext.Provider>
  );
}
