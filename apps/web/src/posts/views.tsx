import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { AnswerSections } from "../answers/views.js";
import { getCourse, getMembership, type Course } from "../courses/client.js";
import {
  confirmMergePost,
  createPost,
  getDuplicateReview,
  getPost,
  listMergedPosts,
  listPosts,
  unmergePost,
  type CreatePostInput,
  type MergedPost,
  type Post,
  type PostDetail,
  type PostListOptions,
  type PostSort,
} from "./client.js";
import { formatPostTime } from "./time.js";
import {
  feedFilters,
  postStatuses,
  postTypeOf,
  type FeedFilter,
} from "./types.js";

/** Builds the course feed request; a search always sends its sort, otherwise only a non-default one. */
function feedOptions(
  query: string | undefined,
  filter: FeedFilter | undefined,
  sort: PostSort,
): PostListOptions {
  return {
    ...(query
      ? { q: query, sort }
      : sort !== "recent_activity"
        ? { sort }
        : {}),
    ...filter?.options,
  };
}

function PostTypeBadge({ type }: { type: string }) {
  const config = postTypeOf(type);
  return (
    <span className={`post-type-badge ${config.tone}`}>
      <span aria-hidden="true">{config.icon}</span>
      {config.label}
    </span>
  );
}

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const discussionPath = (courseId: string, q?: string) =>
  `/courses/${encodeURIComponent(courseId)}${q ? `?${new URLSearchParams({ q })}` : ""}`;
const postPath = (courseId: string, postId: string, q?: string) =>
  `/courses/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(postId)}${q ? `?${new URLSearchParams({ q })}` : ""}`;
const excerpt = (value: string) =>
  value
    .replace(/[#*_`>[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

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
}: {
  courseId: string;
  csrfToken: string;
  onCreated: (post: Post) => void;
  onClose: () => void;
  onStateChange: (dirty: boolean, pending: boolean) => void;
}) {
  const [type, setType] = useState<"question" | "note">("question");
  const [title, setTitle] = useState("");
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
      Boolean(title || body || tags || anonymous || type !== "question"),
      pending,
    );
  }, [anonymous, body, onStateChange, pending, tags, title, type]);

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
  postId?: string;
  onNavigate: (path: string) => void;
  onQueryChange?: (query: string) => void;
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
  const [filter, setFilter] = useState("all");
  // A chosen sort belongs to the search it was chosen for; a new search starts at best match.
  const [sortChoice, setSortChoice] = useState<{
    query: string | undefined;
    sort: PostSort;
  }>();
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
  const composerState = useRef({ dirty: false, pending: false });
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
  const filters = feedFilters(userId);
  const activeFilter = filters.find((item) => item.key === filter);
  const sort: PostSort =
    sortChoice &&
    sortChoice.query === query &&
    (query || sortChoice.sort !== "relevance")
      ? sortChoice.sort
      : query
        ? "relevance"
        : "recent_activity";
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
  }, [courseId, query, feedCycle, postView, filter, sort, userId]);
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
            onNavigate(postPath(courseId, next.redirectToPostId, query));
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
  }, [courseId, onNavigate, postId, query]);

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
        : feedOptions(query, activeFilter, sort)),
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
        className={`discussion-columns${postId || selectedReviewId || composerOpen ? " has-selection" : ""}`}
      >
        <aside className="discussion-sidebar" aria-label="Post filters">
          <fieldset disabled={postView === "duplicates"}>
            <legend>Show</legend>
            <div className="sidebar-filters">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.nested ? "nested" : undefined}
                  aria-label={item.ariaLabel}
                  aria-pressed={filter === item.key}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="sidebar-sort">
              Sort by
              <select
                value={sort}
                onChange={(event) =>
                  setSortChoice({
                    query,
                    sort: event.target.value as PostSort,
                  })
                }
              >
                {query && <option value="relevance">Best match</option>}
                <option value="recent_activity">Last updated</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
          </fieldset>
        </aside>
        <section className="discussion-feed" aria-label="Posts">
          {staff && (
            <label className="post-view-picker">
              Post view
              <select
                aria-label="Post view"
                value={postView}
                onChange={(event) => {
                  setSelectedReviewId(undefined);
                  setReviewDetail(undefined);
                  setReviewDetailError("");
                  setPostView(event.target.value as "posts" | "duplicates");
                }}
              >
                <option value="posts">Posts</option>
                <option value="duplicates">Duplicate posts</option>
              </select>
            </label>
          )}
          <div className="discussion-toolbar">
            <div role="search">
              <label className="visually-hidden" htmlFor="post-search">
                Search posts
              </label>
              <input
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
            </div>
            <button
              type="button"
              className="button primary"
              disabled={course?.status !== "active"}
              onClick={() => setComposerOpen(true)}
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
                  <li key={post.id}>
                    <a
                      className={`post-card${post.id === postId ? " selected" : ""}`}
                      href={postPath(courseId, post.id, query)}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(postPath(courseId, post.id, query));
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
                              <span
                                key={status.label}
                                className={`post-status ${status.tone}`}
                              >
                                {status.label}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="post-card-preview">
                        {excerpt(post.bodyMarkdown)}
                      </span>
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
                  </li>
                ))}
              </ul>
            ) : (
              <p>No posts found.</p>
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
                      onNavigate(discussionPath(courseId, query));
                  }}
                >
                  ← Back to posts
                </button>
                <Composer
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
                    onNavigate(postPath(courseId, post.id, query));
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
                      <ReactMarkdown>{reviewDetail.bodyMarkdown}</ReactMarkdown>
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
                  onClick={() => navigate(discussionPath(courseId, query))}
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
                    </p>
                    <div className="post-markdown">
                      <ReactMarkdown>{detail.bodyMarkdown}</ReactMarkdown>
                    </div>
                    {detail.type === "question" && (
                      <AnswerSections
                        postId={detail.id}
                        role={role}
                        courseStatus={course?.status}
                        csrfToken={csrfToken}
                      />
                    )}
                    {staff && postView === "posts" && (
                      <MergeControl
                        source={detail}
                        courseId={courseId}
                        csrfToken={csrfToken}
                        onMerged={(targetId) => {
                          setFeedCycle((value) => value + 1);
                          onNavigate(postPath(courseId, targetId, query));
                        }}
                      />
                    )}
                  </article>
                )}
              </>
            ) : (
              <div className="detail-prompt">
                <h2>Select a post</h2>
                <p>Choose a post to read it here.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
