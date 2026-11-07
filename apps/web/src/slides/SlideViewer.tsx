import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EmptyState } from "../app/EmptyState.js";
import { downloadPath } from "../course-files/client.js";
import {
  getPost,
  listPostFolders,
  type AnchorBox,
  type Post,
  type PostFolder,
} from "../posts/client.js";
import { MentionContext, mentionSuggestions } from "../posts/mentions.js";
import { PostBody } from "../posts/PostBody.js";
import { Composer } from "../posts/views.js";
import AnchorCrop from "./AnchorCrop.js";
import {
  getResource,
  isPdf,
  listResourceQuestions,
  type ResourceQuestions,
} from "./client.js";
import {
  FULL_PAGE,
  boxFromPoints,
  boxToPixels,
  markerOffsets,
} from "./geometry.js";
import { loadPdf, type PDFDocumentProxy } from "./pdf.js";

type Size = { width: number; height: number };
type Selection = { page: number; box: AnchorBox };
type Drag = {
  page: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  size: Size;
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
// Pages this far outside the visible area still render, so scrolling is smooth.
const RENDER_MARGIN = "900px 0px";

/** One rendered page: a canvas drawn at the current scale once it is near view. */
function SlidePage({
  doc,
  number,
  size,
  scale,
  near,
}: {
  doc: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  near: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!near) return;
    let active = true;
    let cancel = () => {};
    void (async () => {
      const page = await doc.getPage(number);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      const target = canvas.current;
      if (!active || !target) return;
      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      const task = page.render({
        canvasContext: target.getContext("2d")!,
        viewport,
      });
      cancel = () => task.cancel();
      await task.promise.catch(() => {});
    })();
    return () => {
      active = false;
      cancel();
    };
  }, [doc, number, scale, near]);
  return (
    <canvas
      ref={canvas}
      className="slide-canvas"
      aria-hidden="true"
      style={{ width: size.width * scale, height: size.height * scale }}
    />
  );
}

export default function SlideViewer({
  courseId,
  resourceId,
  initialPage,
  initialPostId,
  csrfToken,
  staff,
  active,
  allowAnonymousPosting,
  allowPrivatePosting,
  onNavigate,
  onBeforeLeaveChange,
}: {
  courseId: string;
  resourceId: string;
  initialPage?: number;
  initialPostId?: string;
  csrfToken: string;
  staff: boolean;
  /** Archived courses keep the slides readable but close asking. */
  active: boolean;
  allowAnonymousPosting?: boolean;
  allowPrivatePosting?: boolean;
  onNavigate: (path: string) => void;
  onBeforeLeaveChange?: (guard: () => boolean) => void;
}) {
  const [cycle, setCycle] = useState(0);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState<string>();
  const [fileId, setFileId] = useState<string>();
  const [progress, setProgress] = useState<number>();
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<Size[]>([]);
  const [questions, setQuestions] = useState<ResourceQuestions>();
  const [folders, setFolders] = useState<PostFolder[]>([]);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [frameWidth, setFrameWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [pageInput, setPageInput] = useState(String(initialPage ?? 1));
  const [near, setNear] = useState<Set<number>>(() => new Set());
  const [drag, setDrag] = useState<Drag>();
  const [selection, setSelection] = useState<Selection>();
  const [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState(initialPostId);
  const [selectedPost, setSelectedPost] = useState<Post>();
  const [askMode, setAskMode] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const composerGuard = useRef<() => boolean>(() => true);
  const openedAt = useRef(false);
  // While a page jump animates, scroll events must not pick a different page.
  const jumping = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The resource, then its PDF and every page's size, so pages hold their space.
  useEffect(() => {
    const controller = new AbortController();
    setMissing(false);
    setError("");
    setDoc(undefined);
    setSizes([]);
    setProgress(undefined);
    void (async () => {
      try {
        const resource = await getResource(
          courseId,
          resourceId,
          controller.signal,
        );
        if (!isPdf(resource) || !resource.fileId) {
          setMissing(true);
          return;
        }
        setTitle(resource.title);
        setFileId(resource.fileId);
        const pdf = await loadPdf(courseId, resource.fileId, setProgress);
        const views = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, index) =>
            pdf
              .getPage(index + 1)
              .then((page) => page.getViewport({ scale: 1 })),
          ),
        );
        if (controller.signal.aborted) return;
        setSizes(views.map(({ width, height }) => ({ width, height })));
        setDoc(pdf);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (
          caught &&
          typeof caught === "object" &&
          "status" in caught &&
          caught.status === 404
        )
          setMissing(true);
        else
          setError(
            caught instanceof Error && caught.message
              ? caught.message
              : "The slides could not be loaded.",
          );
      }
    })();
    return () => controller.abort();
  }, [courseId, resourceId, cycle]);

  const refreshQuestions = useCallback(
    (signal?: AbortSignal) =>
      listResourceQuestions(courseId, resourceId, signal)
        .then(setQuestions)
        .catch(() => {
          // The slides stay readable when questions can't load; markers return on retry.
        }),
    [courseId, resourceId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refreshQuestions(controller.signal);
    return () => controller.abort();
  }, [refreshQuestions, cycle]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    listPostFolders(courseId)
      .then((value) => current && setFolders(value))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, courseId]);

  // Fit-to-width follows the frame's width.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setFrameWidth(entry!.contentRect.width),
    );
    observer.observe(element);
    setFrameWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [doc]);
  const widest = Math.max(1, ...sizes.map((size) => size.width));
  const scale =
    zoom === "fit"
      ? Math.max(0.25, (frameWidth - 32) / widest)
      : (zoom * (frameWidth - 32 || widest)) / widest;

  // Render only pages near the visible area.
  useEffect(() => {
    const root = frame.current;
    if (!doc || !root) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setNear((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        }),
      { root, rootMargin: RENDER_MARGIN },
    );
    for (const element of pageRefs.current)
      if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [doc, scale]);

  const goToPage = useCallback((page: number, smooth = true) => {
    const element = pageRefs.current[page - 1];
    const root = frame.current;
    if (!element || !root) return;
    clearTimeout(jumping.current);
    jumping.current = setTimeout(() => {
      jumping.current = undefined;
    }, 700);
    root.scrollTo({
      top: element.offsetTop - 12,
      behavior: smooth ? "smooth" : "auto",
    });
    setCurrentPage(page);
    setPageInput(String(page));
  }, []);
  useEffect(() => () => clearTimeout(jumping.current), []);
  // Open on the linked page once the pages have their sizes.
  useEffect(() => {
    if (!doc || openedAt.current || !frameWidth) return;
    openedAt.current = true;
    const page = Math.min(Math.max(initialPage ?? 1, 1), doc.numPages);
    requestAnimationFrame(() => goToPage(page, false));
  }, [doc, frameWidth, goToPage, initialPage]);
  function trackPage() {
    const root = frame.current;
    if (!root) return;
    if (jumping.current) {
      // Keep the jump's page until scrolling settles.
      clearTimeout(jumping.current);
      jumping.current = setTimeout(() => {
        jumping.current = undefined;
      }, 150);
      return;
    }
    const line = root.scrollTop + root.clientHeight * 0.3;
    let page = 1;
    pageRefs.current.forEach((element, index) => {
      if (element && element.offsetTop <= line) page = index + 1;
    });
    if (page !== currentPage) {
      setCurrentPage(page);
      setPageInput(String(page));
    }
  }

  // A deep-linked or chosen question loads its body for the panel preview.
  useEffect(() => {
    setSelectedPost(undefined);
    if (!selectedId) return;
    const controller = new AbortController();
    getPost(selectedId, controller.signal)
      .then((post) => {
        if ("deleted" in post && post.deleted === false) setSelectedPost(post);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedId]);
  const entries = useMemo(() => questions?.data ?? [], [questions]);
  const selected = entries.find((entry) => entry.id === selectedId);
  // A linked question selects its page once the list arrives.
  useEffect(() => {
    if (selected && doc && initialPostId === selected.id)
      goToPage(selected.page);
    // Only the first arrival of the linked question moves the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(selected && doc)]);

  const leave = useCallback(() => composerGuard.current(), []);
  useEffect(() => {
    onBeforeLeaveChange?.(leave);
    return () => onBeforeLeaveChange?.(() => true);
  }, [leave, onBeforeLeaveChange]);
  function closeComposer() {
    if (!composerGuard.current()) return false;
    composerGuard.current = () => true;
    setComposing(false);
    setSelection(undefined);
    return true;
  }

  function pointer(event: ReactPointerEvent<HTMLDivElement>, page: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      size: { width: rect.width, height: rect.height },
      page,
    };
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>, page: number) {
    if (!active || composing || event.button !== 0) return;
    // On touch screens a drag scrolls unless Ask mode is on.
    if (event.pointerType === "touch" && !askMode) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks still draws, without capture.
    }
    const { point, size } = pointer(event, page);
    setDrag({ page, start: point, end: point, size });
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>, page: number) {
    if (!drag || drag.page !== page) return;
    setDrag({ ...drag, end: pointer(event, page).point });
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>, page: number) {
    if (!drag || drag.page !== page) return;
    const box = boxFromPoints(
      drag.start,
      pointer(event, page).point,
      drag.size,
    );
    setDrag(undefined);
    setSelection(box ? { page, box } : undefined);
  }
  function askAbout(target: Selection) {
    setSelection(target);
    setSelectedId(undefined);
    setComposing(true);
  }

  if (missing)
    return (
      <div className="slide-viewer-missing">
        <EmptyState art="resources" title="These slides aren't available">
          They may have been removed, or they are only for course staff.
        </EmptyState>
        <button
          type="button"
          className="button secondary"
          onClick={() => onNavigate(`/courses/${courseId}/resources`)}
        >
          Back to course resources
        </button>
      </div>
    );

  const pageQuestions = entries.filter((entry) => entry.page === currentPage);
  const numbered = new Map(
    sizes.map((_, index) => {
      const onPage = entries.filter((entry) => entry.page === index + 1);
      return [index + 1, onPage] as const;
    }),
  );
  const draftBox =
    drag && boxFromPoints(drag.start, drag.end, drag.size)
      ? {
          page: drag.page,
          box: boxFromPoints(drag.start, drag.end, drag.size)!,
        }
      : undefined;
  const highlighted =
    composing || !selected
      ? selection
      : { page: selected.page, box: selected.box };

  return (
    <section className="slide-viewer" aria-labelledby="slide-viewer-title">
      <header className="slide-toolbar">
        <button
          type="button"
          className="text-button slide-back"
          onClick={() => {
            if (closeComposer() || !composing)
              onNavigate(`/courses/${courseId}/resources`);
          }}
        >
          ← Course resources
        </button>
        <h2 id="slide-viewer-title">
          {title ?? <span className="skeleton skeleton-title-inline" />}
        </h2>
        <nav className="slide-pager" aria-label="Pages">
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Previous page"
            disabled={!doc || currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            ‹
          </button>
          <label>
            <span className="visually-hidden">Page</span>
            <input
              inputMode="numeric"
              value={pageInput}
              disabled={!doc}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => setPageInput(String(currentPage))}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !doc) return;
                const page = Number(pageInput);
                if (Number.isInteger(page) && page >= 1 && page <= doc.numPages)
                  goToPage(page);
                else setPageInput(String(currentPage));
              }}
            />
          </label>
          <span className="slide-page-count">of {doc?.numPages ?? "…"}</span>
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Next page"
            disabled={!doc || currentPage >= doc.numPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            ›
          </button>
        </nav>
        <div className="slide-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Zoom out"
            disabled={!doc}
            onClick={() =>
              setZoom(
                ZOOMS.filter((value) => value < (zoom === "fit" ? 1 : zoom)).at(
                  -1,
                ) ?? ZOOMS[0]!,
              )
            }
          >
            −
          </button>
          <button
            type="button"
            className="text-button"
            aria-pressed={zoom === "fit"}
            disabled={!doc}
            onClick={() => setZoom("fit")}
          >
            Fit width
          </button>
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Zoom in"
            disabled={!doc}
            onClick={() =>
              setZoom(
                ZOOMS.find((value) => value > (zoom === "fit" ? 1 : zoom)) ??
                  ZOOMS.at(-1)!,
              )
            }
          >
            +
          </button>
        </div>
        {active && (
          <button
            type="button"
            className="text-button slide-ask-mode"
            aria-pressed={askMode}
            onClick={() => setAskMode((value) => !value)}
          >
            {askMode ? "Done marking" : "Mark an area"}
          </button>
        )}
        {fileId && (
          <a
            className="text-button slide-download"
            href={downloadPath(courseId, fileId)}
          >
            Download
          </a>
        )}
      </header>

      <div className="slide-body">
        <div
          ref={frame}
          className={`slide-pages${askMode ? " marking" : ""}`}
          onScroll={trackPage}
          tabIndex={0}
          aria-label="Slides"
        >
          {error ? (
            <div className="slide-status" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => setCycle((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : !doc ? (
            <div className="slide-status">
              <p role="status" className="loading-line">
                Loading slides…
              </p>
              {progress !== undefined && (
                <progress
                  value={progress}
                  max={1}
                  aria-label="Slides downloaded"
                />
              )}
            </div>
          ) : (
            sizes.map((size, index) => {
              const number = index + 1;
              const width = size.width * scale;
              const height = size.height * scale;
              const onPage = numbered.get(number) ?? [];
              const offsets = markerOffsets(onPage.map((entry) => entry.box));
              const outline =
                draftBox?.page === number
                  ? draftBox.box
                  : highlighted?.page === number
                    ? highlighted.box
                    : undefined;
              return (
                <div
                  key={number}
                  ref={(element) => {
                    pageRefs.current[index] = element;
                  }}
                  className="slide-page"
                  data-page={number}
                  style={{ width, height }}
                  role="group"
                  aria-label={`Page ${number}`}
                >
                  <SlidePage
                    doc={doc}
                    number={number}
                    size={size}
                    scale={scale}
                    near={near.has(number)}
                  />
                  <div
                    className="slide-overlay"
                    onPointerDown={(event) => startDrag(event, number)}
                    onPointerMove={(event) => moveDrag(event, number)}
                    onPointerUp={(event) => endDrag(event, number)}
                    onPointerCancel={() => setDrag(undefined)}
                  />
                  {outline && (
                    <div
                      className={`slide-box${draftBox?.page === number ? " drawing" : ""}`}
                      style={boxToPixels(outline, { width, height })}
                      aria-hidden="true"
                    />
                  )}
                  {onPage.map((entry, position) => {
                    const at = boxToPixels(entry.box, { width, height });
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`slide-marker${entry.answered ? " answered" : ""}${entry.id === selectedId ? " selected" : ""}`}
                        style={{
                          left: Math.min(
                            at.left + offsets[position]! * 26,
                            width - 26,
                          ),
                          top: Math.max(at.top - 13, 0),
                        }}
                        aria-label={`Question ${position + 1} on page ${number}: ${entry.title}${entry.type === "question" ? (entry.answered ? ", answered" : ", unanswered") : ""}`}
                        aria-pressed={entry.id === selectedId}
                        onClick={() => {
                          if (composing && !closeComposer()) return;
                          setSelectedId(entry.id);
                          setCurrentPage(number);
                          setPageInput(String(number));
                        }}
                      >
                        {position + 1}
                      </button>
                    );
                  })}
                  {active &&
                    !composing &&
                    selection?.page === number &&
                    selection.box !== FULL_PAGE && (
                      <button
                        type="button"
                        className="button primary slide-ask-here"
                        style={{
                          left: Math.min(
                            (selection.box.x + selection.box.width) * width -
                              132,
                            width - 140,
                          ),
                          top: Math.min(
                            (selection.box.y + selection.box.height) * height +
                              8,
                            height - 44,
                          ),
                        }}
                        onClick={() => askAbout(selection)}
                      >
                        Ask about this
                      </button>
                    )}
                </div>
              );
            })
          )}
        </div>

        <aside className="slide-panel" aria-labelledby="slide-panel-title">
          {composing && selection && fileId ? (
            <MentionContext.Provider
              value={(query) => mentionSuggestions(courseId, query)}
            >
              <h3 id="slide-panel-title">Ask about page {selection.page}</h3>
              <Composer
                courseId={courseId}
                csrfToken={csrfToken}
                staff={staff}
                folders={folders}
                archived={!active}
                allowAnonymousPosting={allowAnonymousPosting}
                allowPrivatePosting={allowPrivatePosting}
                anchor={{
                  resourceId,
                  fileId,
                  page: selection.page,
                  box: selection.box,
                }}
                anchorPreview={
                  <AnchorCrop
                    courseId={courseId}
                    fileId={fileId}
                    page={selection.page}
                    box={selection.box}
                    label={`The marked area of ${title ?? "the slides"}, page ${selection.page}`}
                  />
                }
                onAnchorStale={() => setCycle((value) => value + 1)}
                onClose={closeComposer}
                onDiscardLocalChanges={() => {
                  composerGuard.current = () => true;
                  setComposing(false);
                  setSelection(undefined);
                }}
                onLeaveRequestChange={(guard) => {
                  composerGuard.current = guard;
                }}
                onStateChange={() => {}}
                onCreated={(post) => {
                  composerGuard.current = () => true;
                  setComposing(false);
                  setSelection(undefined);
                  setSelectedId(post.id);
                  void refreshQuestions();
                }}
              />
            </MentionContext.Provider>
          ) : (
            <>
              <h3 id="slide-panel-title">
                Page {currentPage} questions
                <span className="slide-panel-count">
                  {pageQuestions.length}
                </span>
              </h3>
              {active ? (
                <div className="slide-ask">
                  {selection && selection.page === currentPage ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => askAbout(selection)}
                    >
                      Ask about this area
                    </button>
                  ) : (
                    <p className="slide-hint">
                      Drag on a slide to mark the part you're asking about.
                    </p>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!doc}
                    onClick={() =>
                      askAbout({ page: currentPage, box: FULL_PAGE })
                    }
                  >
                    Ask about this page
                  </button>
                </div>
              ) : (
                <p className="slide-hint">
                  This course is archived, so new questions are closed.
                </p>
              )}
              {pageQuestions.length ? (
                <ol className="slide-question-list">
                  {pageQuestions.map((entry, position) => (
                    <li
                      key={entry.id}
                      className={
                        entry.id === selectedId ? "selected" : undefined
                      }
                    >
                      <button
                        type="button"
                        aria-pressed={entry.id === selectedId}
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <span
                          className="slide-question-number"
                          aria-hidden="true"
                        >
                          {position + 1}
                        </span>
                        <span className="slide-question-title">
                          {entry.title}
                        </span>
                        {entry.type === "question" && (
                          <span
                            className={`slide-question-status${entry.answered ? " answered" : ""}`}
                          >
                            {entry.answered ? "Answered" : "Unanswered"}
                          </span>
                        )}
                      </button>
                      {entry.id === selectedId && (
                        <div className="slide-question-detail">
                          {selectedPost?.id === entry.id ? (
                            <div className="slide-question-preview">
                              <PostBody
                                bodyMarkdown={selectedPost.bodyMarkdown}
                              />
                            </div>
                          ) : (
                            <p role="status" className="loading-line">
                              Loading question…
                            </p>
                          )}
                          {entry.type === "question" &&
                            Boolean(entry.unresolvedFollowups) && (
                              <p className="slide-question-meta">
                                {entry.unresolvedFollowups} open followup
                                {entry.unresolvedFollowups === 1 ? "" : "s"}
                              </p>
                            )}
                          <a
                            href={`/courses/${courseId}/posts/${entry.id}`}
                            onClick={(event) => {
                              if (
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey
                              )
                                return;
                              event.preventDefault();
                              onNavigate(
                                `/courses/${courseId}/posts/${entry.id}`,
                              );
                            }}
                          >
                            Open in Discussion
                          </a>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="slide-hint">No questions on this page yet.</p>
              )}
              {Boolean(questions?.earlierVersionCount) && (
                <p className="slide-earlier">
                  {questions!.earlierVersionCount} question
                  {questions!.earlierVersionCount === 1
                    ? " was"
                    : "s were"}{" "}
                  asked on an earlier version of these slides.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
