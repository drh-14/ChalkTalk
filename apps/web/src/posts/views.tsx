import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { feedSearch, hasFilters, type FeedFilters } from "../app/routes.js";
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
} from "./client.js";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const discussionPath = (courseId: string, q?: string, filters?: FeedFilters) =>
  `/courses/${encodeURIComponent(courseId)}${feedSearch(q, filters)}`;
const postPath = (
  courseId: string,
  postId: string,
  q?: string,
  filters?: FeedFilters,
) =>
  `/courses/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(postId)}${feedSearch(q, filters)}`;
const excerpt = (value: string) =>
  value
    .replace(/[#*_`>[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

type FeedKind = "all" | "question" | "note" | "unanswered";
const FEED_KINDS: { value: FeedKind; label: string; hint?: string }[] = [
  { value: "all", label: "All posts" },
  { value: "question", label: "Questions" },
  { value: "note", label: "Notes" },
  {
    value: "unanswered",
    label: "Unanswered",
    hint: "Questions that do not have an answer yet",
  },
];

function feedKind(filters: FeedFilters): FeedKind {
  if (filters.answered === false) return "unanswered";
  return filters.type ?? "all";
}

function withFeedKind(filters: FeedFilters, kind: FeedKind): FeedFilters {
  const next: FeedFilters = { ...filters };
  delete next.type;
  delete next.answered;
  if (kind === "unanswered") next.answered = false;
  else if (kind !== "all") next.type = kind;
  return next;
}

/** Maps applied search and filters to documented course post list parameters. */
function feedOptions(query: string | undefined, filters: FeedFilters) {
  const options: PostListOptions = {};
  if (query) {
    options.q = query;
    options.sort = "relevance";
  } else if (filters.sort) options.sort = filters.sort;
  if (filters.answered === false) options.answered = false;
  else if (filters.type) options.type = filters.type;
  if (filters.tag) options.tag = filters.tag;
  return options;
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function relativeTime(date: Date, now = Date.now()): string {
  const seconds = (date.getTime() - now) / 1000;
  const size = Math.abs(seconds);
  if (size < 45) return "just now";
  if (size < 45 * 60)
    return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (size < 22 * 3600)
    return relativeFormat.format(Math.round(seconds / 3600), "hour");
  if (size < 7 * 86400)
    return relativeFormat.format(Math.round(seconds / 86400), "day");
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

function RelativeTime({ value, prefix }: { value: string; prefix?: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const full = date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <time dateTime={value} title={full}>
      <span aria-hidden="true">
        {prefix}
        {relativeTime(date)}
      </span>
      <span className="visually-hidden">
        {prefix}
        {full}
      </span>
    </time>
  );
}

function PostBadges({ post }: { post: Post }) {
  return (
    <>
      {post.pinned && <span className="badge badge-pin">Pinned</span>}
      {post.type === "question" && post.answered === false && (
        <span className="badge badge-open">Unanswered</span>
      )}
    </>
  );
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
  initialTitle = "",
  onCreated,
  onClose,
  onStateChange,
}: {
  courseId: string;
  csrfToken: string;
  initialTitle?: string;
  onCreated: (post: Post) => void;
  onClose: () => void;
  onStateChange: (dirty: boolean, pending: boolean) => void;
}) {
  const [type, setType] = useState<"question" | "note">("question");
  const [title, setTitle] = useState(initialTitle);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (initialTitle) bodyField.current?.focus();
    // Focus moves once, when a search opens the composer with a title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [body, setBody] = useState("");
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
      bodyMarkdown: body.trim(),
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
    if (!input.bodyMarkdown || input.bodyMarkdown.length > 100000) {
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
        <label>
          Post body
          <textarea
            ref={bodyField}
            aria-label="Post body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
          />
        </label>
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
                      <span>{excerpt(post.bodyMarkdown)}</span>
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
        className="button secondary"
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
  filters?: FeedFilters;
  postId?: string;
  onNavigate: (path: string) => void;
  onQueryChange?: (query: string) => void;
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
  filters,
  postId,
  onNavigate,
  onQueryChange,
  onFiltersChange,
  onBeforeLeaveChange,
}: DiscussionProps) {
  const [ownFilters, setOwnFilters] = useState<FeedFilters>(filters ?? {});
  // The URL owns filters inside the app; standalone use keeps them locally.
  const activeFilters = onFiltersChange ? (filters ?? {}) : ownFilters;
  const filterKey = feedSearch(undefined, activeFilters);
  const changeFilters = onFiltersChange ?? setOwnFilters;
  const feedLocation = useRef({ query, filters: activeFilters });
  feedLocation.current = { query, filters: activeFilters };
  const [localCourse, setCourse] = useState<Course>();
  const course = sharedCourse ?? localCourse;
  const [courseError, setCourseError] = useState("");
  const [draftQuery, setDraftQuery] = useState(query ?? "");
  const [items, setItems] = useState<Post[]>([]);
  const [mergedItems, setMergedItems] = useState<MergedPost[]>([]);
  const [staff, setStaff] = useState(false);
  const [postView, setPostView] = useState<"posts" | "duplicates">("posts");
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
  const [detailCycle, setDetailCycle] = useState(0);
  const [pinPending, setPinPending] = useState(false);
  const [pinError, setPinError] = useState("");
  const listScroll = useRef(0);
  const [composerSeed, setComposerSeed] = useState<{
    title: string;
    id: number;
  }>();
  const searchInput = useRef<HTMLInputElement>(null);
  const composerState = useRef({ dirty: false, pending: false });
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
        if (active) setStaff(data.role === "ta" || data.role === "instructor");
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
    void (
      postView === "duplicates"
        ? listMergedPosts(courseId, {
            ...(query ? { q: query, sort: "relevance" as const } : {}),
            signal: controller.signal,
          })
        : listPosts(courseId, {
            ...feedOptions(query, feedLocation.current.filters),
            signal: controller.signal,
          })
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
  }, [courseId, query, filterKey, feedCycle, postView]);
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
              postPath(
                courseId,
                next.redirectToPostId,
                query,
                feedLocation.current.filters,
              ),
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
  }, [courseId, onNavigate, postId, query, detailCycle]);
  useEffect(() => {
    setPinError("");
  }, [postId]);
  // Narrow screens show list and detail separately; restore the list position.
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
    void (
      postView === "duplicates"
        ? listMergedPosts(courseId, {
            ...(query ? { q: query, sort: "relevance" as const } : {}),
            cursor,
          })
        : listPosts(courseId, { ...feedOptions(query, activeFilters), cursor })
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
    navigate(postPath(courseId, id, query, activeFilters));
  }
  function selectTag(tag: string) {
    changeFilters({ ...activeFilters, tag });
  }
  function clearSearch() {
    setDraftQuery("");
    if (query) {
      lastRequestedQuery.current = "";
      onQueryChange?.("");
    }
    searchInput.current?.focus();
  }
  function openComposer(title?: string) {
    if (composerOpen && !title) return;
    if (composerOpen && !leaveComposer()) return;
    setComposerSeed(title ? { title, id: Date.now() } : undefined);
    setComposerOpen(true);
  }
  function clearSearchAndFilters() {
    setDraftQuery("");
    if (query) {
      lastRequestedQuery.current = "";
      onQueryChange?.("");
    }
    changeFilters({});
  }
  const askOffer =
    query && postView === "posts" && course?.status === "active" ? (
      <button
        type="button"
        className="button secondary compact ask-button"
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
      setItems((prior) =>
        prior.map((item) =>
          item.id === next.id
            ? { ...item, pinned: next.pinned, version: next.version }
            : item,
        ),
      );
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
        className={`discussion-columns${postId || selectedReviewId || composerOpen ? " has-selection" : ""}${postView === "posts" ? " has-filters" : ""}`}
      >
        {postView === "posts" && (
          <aside className="discussion-filters" aria-label="Filters">
            <fieldset className="filter-group">
              <legend>Show</legend>
              {FEED_KINDS.map((kind) => (
                <label
                  className="filter-option"
                  key={kind.value}
                  title={kind.hint}
                >
                  <input
                    type="radio"
                    name={`feed-kind-${courseId}`}
                    value={kind.value}
                    checked={feedKind(activeFilters) === kind.value}
                    onChange={() =>
                      changeFilters(withFeedKind(activeFilters, kind.value))
                    }
                  />
                  <span>{kind.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="filter-sort">
              <span>Sort</span>
              <select
                aria-label="Sort posts"
                value={
                  query
                    ? "relevance"
                    : (activeFilters.sort ?? "recent_activity")
                }
                disabled={Boolean(query)}
                onChange={(event) =>
                  changeFilters({
                    ...activeFilters,
                    sort: event.target.value as "newest" | "recent_activity",
                  })
                }
              >
                {query && <option value="relevance">Relevance</option>}
                <option value="recent_activity">Recent activity</option>
                <option value="newest">Newest</option>
              </select>
            </label>
            {activeFilters.tag && (
              <div className="active-tag">
                <span>Tag</span>
                <button
                  type="button"
                  className="tag-chip active"
                  aria-label={`Remove tag filter ${activeFilters.tag}`}
                  onClick={() => {
                    const next = { ...activeFilters };
                    delete next.tag;
                    changeFilters(next);
                  }}
                >
                  #{activeFilters.tag}
                  <span aria-hidden="true"> ×</span>
                </button>
              </div>
            )}
          </aside>
        )}
        <section className="discussion-feed" aria-label="Posts">
          <div className="discussion-toolbar">
            <div className="search-row">
              <div role="search" className="search-field">
                <label className="visually-hidden" htmlFor="post-search">
                  Search posts
                </label>
                <svg
                  className="search-icon"
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                >
                  <circle
                    cx="8.5"
                    cy="8.5"
                    r="5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="m13 13 4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
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
                {draftQuery ? (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                ) : (
                  <kbd className="search-key" aria-hidden="true">
                    /
                  </kbd>
                )}
              </div>
              <button
                type="button"
                className="button secondary create-post"
                disabled={course?.status !== "active"}
                onClick={() => openComposer()}
              >
                <span aria-hidden="true">+</span> Create post
              </button>
            </div>
            <p id="post-search-help" className="search-help">
              Search words, "quoted phrases", OR, or -excluded terms.
            </p>
            {staff && (
              <fieldset className="post-view-toggle">
                <legend>Post view</legend>
                {(
                  [
                    ["posts", "Posts"],
                    ["duplicates", "Duplicate posts"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`post-view-${courseId}`}
                      value={value}
                      checked={postView === value}
                      onChange={() => {
                        setSelectedReviewId(undefined);
                        setReviewDetail(undefined);
                        setReviewDetailError("");
                        setPostView(value);
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <p className="result-count" aria-live="polite">
            {query &&
            postView === "posts" &&
            !loading &&
            !feedError &&
            items.length
              ? `${items.length}${cursor ? "+" : ""} ${
                  items.length === 1 && !cursor ? "result" : "results"
                } for "${query}"`
              : ""}
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
                    className={`post-row${post.id === postId ? " selected" : ""}`}
                  >
                    <a
                      className={`post-card${post.id === postId ? " selected" : ""}`}
                      href={postPath(courseId, post.id, query, activeFilters)}
                      onClick={(event) => {
                        event.preventDefault();
                        openPost(post.id);
                      }}
                      aria-current={post.id === postId ? "page" : undefined}
                    >
                      <span className="post-row-meta">
                        <span className="post-kind">{post.type}</span>
                        <PostBadges post={post} />
                        <RelativeTime value={post.createdAt} />
                      </span>
                      <strong>{post.title}</strong>
                      <span className="post-excerpt">
                        {excerpt(post.bodyMarkdown)}
                      </span>
                      <small>{post.author.displayName}</small>
                    </a>
                    <TagList
                      tags={post.tags}
                      active={activeFilters.tag}
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
        <section className="discussion-detail" aria-label="Post detail">
          {composerOpen ? (
            <>
              <button
                type="button"
                className="text-button narrow-back"
                onClick={() => {
                  if (leaveComposer() && postId)
                    onNavigate(discussionPath(courseId, query, activeFilters));
                }}
              >
                ← Back to posts
              </button>
              <Composer
                key={composerSeed?.id ?? 0}
                courseId={courseId}
                csrfToken={csrfToken}
                initialTitle={composerSeed?.title}
                onClose={leaveComposer}
                onStateChange={(dirty, pending) => {
                  composerState.current = { dirty, pending };
                }}
                onCreated={(post) => {
                  composerState.current = { dirty: false, pending: false };
                  setComposerOpen(false);
                  setFeedCycle((value) => value + 1);
                  onNavigate(postPath(courseId, post.id, query, activeFilters));
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
                  <p className="post-kind">{reviewDetail.type}</p>
                  <h2>{reviewDetail.title}</h2>
                  <p className="post-author">
                    {reviewDetail.author.displayName}
                  </p>
                  <div className="post-markdown">
                    <ReactMarkdown>{reviewDetail.bodyMarkdown}</ReactMarkdown>
                  </div>
                  {reviewDetail.tags.length > 0 && (
                    <p>Tags: {reviewDetail.tags.join(", ")}</p>
                  )}
                  <p>
                    Merged into{" "}
                    <a
                      href={postPath(courseId, reviewDetail.duplicateOfPostId!)}
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
                      {mergedItems.find((item) => item.id === selectedReviewId)
                        ?.canonicalTitle ?? "Canonical post"}
                    </a>
                  </p>
                  {mergedItems.find((item) => item.id === selectedReviewId) && (
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
                onClick={() =>
                  navigate(discussionPath(courseId, query, activeFilters))
                }
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
                <article className="post-detail">
                  <header className="post-detail-header">
                    <p className="post-detail-kicker">
                      <span className="post-kind">{detail.type}</span>
                      <PostBadges post={detail} />
                    </p>
                    <h2>{detail.title}</h2>
                    <p className="post-detail-meta">
                      <span className="post-author">
                        {detail.author.displayName}
                      </span>
                      <span aria-hidden="true">·</span>
                      <RelativeTime value={detail.createdAt} />
                      {detail.lastActivityAt &&
                        detail.lastActivityAt !== detail.createdAt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <RelativeTime
                              value={detail.lastActivityAt}
                              prefix="active "
                            />
                          </>
                        )}
                    </p>
                    <TagList
                      tags={detail.tags}
                      active={activeFilters.tag}
                      onSelect={selectTag}
                    />
                  </header>
                  <div className="post-markdown">
                    <ReactMarkdown>{detail.bodyMarkdown}</ReactMarkdown>
                  </div>
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
                      <MergeControl
                        source={detail}
                        courseId={courseId}
                        csrfToken={csrfToken}
                        onMerged={(targetId) => {
                          setFeedCycle((value) => value + 1);
                          onNavigate(
                            postPath(courseId, targetId, query, activeFilters),
                          );
                        }}
                      />
                      {pinError && (
                        <p className="form-message error" role="alert">
                          {pinError}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              )}
            </>
          ) : (
            <div className="detail-prompt">
              <h2>Select a post</h2>
              <p>Choose a question or note from the list to read it here.</p>
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
        </section>
      </div>
    </section>
  );
}
