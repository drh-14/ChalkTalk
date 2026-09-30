import { useEffect, useRef, useState, type FormEvent } from "react";
import { PostBody } from "./PostBody.js";
import { PostEditor, type PostEditorHandle } from "./PostEditor.js";
import type { FormatAction } from "./formatting.js";
import { AnswerSections } from "../answers/views.js";
import { getCourse, getMembership, type Course } from "../courses/client.js";
import {
  confirmMergePost,
  createPost,
  getDuplicateReview,
  getPost,
  listMergedPosts,
  listPosts,
  setPostPinned,
  unmergePost,
  type CreatePostInput,
  type MergedPost,
  type Post,
  type PostDetail,
  type PostListOptions,
  type PostSort,
} from "./client.js";
import { feedSearch, hasFilters, type FeedFilters } from "../app/routes.js";
import { formatPostTime } from "./time.js";
import {
  feedFilters,
  postStatuses,
  postTypeOf,
  type FeedFilter,
  type PostStatus,
} from "./types.js";

// Temporarily disable answer panels and their fetches in post detail.
const ANSWERS_ENABLED = false;

/** Builds the course feed request; a search always sends its sort, otherwise only a non-default one. */
function feedOptions(
  query: string | undefined,
  filter: FeedFilter | undefined,
  sort: PostSort,
  tag: string | undefined,
): PostListOptions {
  return {
    ...(query
      ? { q: query, sort }
      : sort !== "recent_activity"
        ? { sort }
        : {}),
    ...filter?.options,
    ...(tag ? { tag } : {}),
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
  active?: string;
  onSelect: (tag: string) => void;
}) {
  if (!tags.length) return null;
  return (
    <ul className="tag-list" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <button
            type="button"
            className={`tag-chip${tag === active ? " active" : ""}`}
            aria-pressed={tag === active}
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
        .slice(-4)
        .map((word) => word.slice(0, 40)),
    ),
  ].filter((word) => !titleWords.includes(word));
  const selected = [...titleWords];
  for (const word of bodyWords)
    if ([...selected, word].join(" OR ").length <= 500) selected.push(word);
  return selected.join(" OR ");
}

function Composer({
  courseId,
  csrfToken,
  onCreated,
  onClose,
  onStateChange,
  initialTitle = "",
}: {
  courseId: string;
  csrfToken: string;
  onCreated: (post: Post) => void;
  onClose: () => void;
  onStateChange: (dirty: boolean, pending: boolean) => void;
  /** A starting title, such as a search the reader chose to ask as a question. */
  initialTitle?: string;
}) {
  const [type, setType] = useState<"question" | "note">("question");
  const [title, setTitle] = useState(initialTitle);
  const bodyField = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialTitle)
      bodyField.current?.querySelector<HTMLElement>(".cm-content")?.focus();
    // Focus moves once, when a search opens the composer with a title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const editor = useRef<PostEditorHandle>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Post[]>([]);
  const [suggestionsState, setSuggestionsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const lastAttempt = useRef<{ body: string; key: string } | undefined>(
    undefined,
  );
  const query = relatedQuery(title, body);

  useEffect(() => {
    onStateChange(
      Boolean(
        title !== initialTitle ||
        body ||
        tags ||
        anonymous ||
        type !== "question",
      ),
      pending,
    );
  }, [
    anonymous,
    body,
    initialTitle,
    onStateChange,
    pending,
    tags,
    title,
    type,
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
  }, [courseId, query, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input: CreatePostInput = {
      type,
      title: title.trim(),
      bodyMarkdown: body,
      anonymous,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
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
    const payload = JSON.stringify(input);
    const key =
      lastAttempt.current?.body === payload
        ? lastAttempt.current.key
        : crypto.randomUUID();
    lastAttempt.current = { body: payload, key };
    setPending(true);
    setError("");
    try {
      onCreated(await createPost(courseId, input, csrfToken, key));
    } catch (caught) {
      setError(message(caught));
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
      <form onSubmit={submit} noValidate>
        <label>
          Post type
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as "question" | "note")
            }
          >
            <option value="question">Question</option>
            <option value="note">Note</option>
          </select>
        </label>
        <label>
          Post title
          <input
            aria-label="Post title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={201}
            required
          />
        </label>
        <div className="post-body-field">
          <span className="post-body-label">Post body</span>
          <div className="post-body-mode">
            <button
              type="button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              Write
            </button>
            <button
              type="button"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
          </div>
          <div
            className="post-format-toolbar"
            role="toolbar"
            aria-label="Post body formatting"
            hidden={preview}
          >
            {(
              [
                ["bold", "Bold"],
                ["italic", "Italic"],
                ["heading", "Heading"],
                ["link", "Link"],
                ["bullet-list", "Bulleted list"],
                ["numbered-list", "Numbered list"],
                ["code", "Inline code"],
                ["inline-math", "Inline math"],
                ["block-math", "Block math"],
              ] as [FormatAction, string][]
            ).map(([action, label]) => (
              <button
                key={action}
                type="button"
                aria-label={label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.current?.format(action)}
              >
                {label}
              </button>
            ))}
          </div>
          <div hidden={preview} ref={bodyField}>
            <PostEditor ref={editor} value={body} onChange={setBody} />
          </div>
          {preview && (
            <div
              className="post-markdown post-preview"
              role="region"
              aria-label="Post body preview"
            >
              <PostBody bodyMarkdown={body} />
            </div>
          )}
          <small>
            Use $…$ for inline math and standalone $$ lines for block math.
          </small>
        </div>
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
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Publishing…" : "Publish post"}
        </button>
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
  onMerged,
}: {
  source: Post;
  courseId: string;
  csrfToken: string;
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
    if (!target || pending) return;
    setPending(true);
    setError("");
    try {
      await confirmMergePost(source, target.id, csrfToken);
      onMerged(target.id);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
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
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
  const [reviewDetail, setReviewDetail] = useState<Post>();
  const [reviewDetailError, setReviewDetailError] = useState("");
  const [composerSeed, setComposerSeed] = useState<{
    title: string;
    id: number;
  }>();
  const composerState = useRef({ dirty: false, pending: false });
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
  const filterOptions = feedFilters(userId);
  const activeFilter = filterOptions.find(
    (item) => item.key === activeFilters.filter,
  );
  const filter = activeFilter?.key ?? "all";
  const tag = activeFilters.tag;
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
  function selectTag(next: string) {
    changeFilters({ ...activeFilters, tag: next });
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
            feedFilters(userId).find((item) => item.key === filter),
            sort,
            tag,
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
  }, [courseId, query, feedCycle, postView, filter, sort, tag, userId]);
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
        : feedOptions(query, activeFilter, sort, tag)),
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
        if (generation === currentFeed.current) setPageError(message(caught));
      })
      .finally(() => {
        if (generation === currentFeed.current) {
          pageBusy.current = false;
          setPagePending(false);
        }
      });
  }
  function leaveComposer() {
    if (!composerOpen) return true;
    if (composerState.current.pending) return false;
    if (
      composerState.current.dirty &&
      !window.confirm("Discard your unsaved post draft?")
    )
      return false;
    composerState.current = { dirty: false, pending: false };
    setComposerOpen(false);
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
    if (composerOpen && !leaveComposer()) return;
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
    <section className={sharedCourse ? "discussion-body" : "discussion-shell"}>
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
          <fieldset disabled={postView === "duplicates"}>
            <label className="sidebar-show">
              Show
              <select
                value={filter}
                onChange={(event) => {
                  const key = event.target.value;
                  const next = { ...activeFilters };
                  if (key === "all") delete next.filter;
                  else next.filter = key;
                  changeFilters(next);
                }}
              >
                {filterOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.ariaLabel ?? item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sidebar-sort">
              Sort by
              <select
                value={sort}
                onChange={(event) => {
                  if (!onFiltersChange) setLocalSortQuery(query);
                  changeFilters({
                    ...activeFilters,
                    sort: event.target.value as PostSort,
                  });
                }}
              >
                {query && <option value="relevance">Best match</option>}
                <option value="recent_activity">Last updated</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
          </fieldset>
          {tag && postView === "posts" && (
            <div className="active-tag">
              <span>Tag</span>
              <button
                type="button"
                className="tag-chip active"
                aria-label={`Remove tag filter ${tag}`}
                onClick={() => {
                  const next = { ...activeFilters };
                  delete next.tag;
                  changeFilters(next);
                }}
              >
                #{tag}
                <span aria-hidden="true"> ×</span>
              </button>
            </div>
          )}
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
              disabled={course?.status !== "active"}
              onClick={() => openComposer()}
              aria-label="Create post"
            >
              + Create post
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
              <ul className="post-list">
                {items.map((post) => (
                  <li
                    key={post.id}
                    className={post.id === postId ? "selected" : undefined}
                  >
                    <a
                      className={`post-card${post.id === postId ? " selected" : ""}`}
                      href={postPath(courseId, post.id, search)}
                      onClick={(event) => {
                        event.preventDefault();
                        openPost(post.id);
                      }}
                      aria-current={post.id === postId ? "page" : undefined}
                    >
                      <span className="post-card-head">
                        <span className="post-card-title">
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
                        <PostBody bodyMarkdown={post.bodyMarkdown} inertLinks />
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
                      active={tag}
                      onSelect={selectTag}
                    />
                  </li>
                ))}
              </ul>
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
                <Composer
                  key={composerSeed?.id ?? 0}
                  initialTitle={composerSeed?.title}
                  courseId={courseId}
                  csrfToken={csrfToken}
                  onClose={leaveComposer}
                  onStateChange={(dirty, pending) => {
                    composerState.current = { dirty, pending };
                  }}
                  onCreated={(post) => {
                    composerState.current = { dirty: false, pending: false };
                    setComposerOpen(false);
                    setFeedCycle((value) => value + 1);
                    onNavigate(postPath(courseId, post.id, search));
                  }}
                />
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
                            postPath(courseId, reviewDetail.duplicateOfPostId!),
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
                    <p className="post-kind">{postTypeOf(detail.type).label}</p>
                    <h2>{detail.title}</h2>
                    <p className="post-author">
                      <PostByline post={detail} />
                      <ActivityTime post={detail} />
                    </p>
                    <TagList
                      tags={detail.tags}
                      active={tag}
                      onSelect={selectTag}
                    />
                    <div className="post-markdown">
                      <PostBody bodyMarkdown={detail.bodyMarkdown} />
                    </div>
                    {ANSWERS_ENABLED && detail.type === "question" && (
                      <AnswerSections
                        postId={detail.id}
                        role={role}
                        courseStatus={course?.status}
                        csrfToken={csrfToken}
                      />
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
                          onMerged={(targetId) => {
                            setFeedCycle((value) => value + 1);
                            onNavigate(postPath(courseId, targetId, search));
                          }}
                        />
                      </div>
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
  );
}
