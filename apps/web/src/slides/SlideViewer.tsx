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
} from "./client.js";
import {
  FULL_PAGE,
  boxFromPoints,
  boxToPixels,
  markerOffsets,
} from "./geometry.js";
import { loadPdf, loadPdfUrl, TextLayer, type PDFDocumentProxy } from "./pdf.js";
import { ResourceExtractedText } from "../course-files/extracted-text.js";
import type { Resource } from "../course-files/client.js";
import { useQuestions } from "./use-questions.js";
import { useSearchableCopy } from "./use-searchable-copy.js";

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

/** Real selectable text, positioned with the same PDF viewport as the canvas. */
function SelectableText({doc, page, scale, near}: {doc: PDFDocumentProxy; page: number; scale: number; near: boolean}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element || !near) return;
    let active = true;
    let task: TextLayer | undefined;
    element.replaceChildren();
    void (async () => {
      const pdfPage = await doc.getPage(page);
      const content = await pdfPage.getTextContent();
      if (!active) return;
      element.style.setProperty("--scale-factor", String(scale));
      task = new TextLayer({textContentSource: content, container: element, viewport: pdfPage.getViewport({scale})});
      await task.render();
    })().catch(() => {});
    return () => {active = false; task?.cancel(); element.replaceChildren();};
  }, [doc, page, scale, near]);
  return <div ref={container} className="slide-selectable-text" />;
}

export default function SlideViewer({
  courseId,
  resourceId,
  initialPage,
  initialPanel,
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
  initialPanel?: "text";
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
  const [resource, setResource] = useState<Resource>();
  const [pdfMode, setPdfMode] = useState<"original" | "searchable">("original");
  const [panel, setPanel] = useState<"questions" | "text">(initialPanel === "text" ? "text" : "questions");
  const [mobileTab, setMobileTab] = useState<"pdf" | "questions" | "text">(initialPanel === "text" ? "text" : "pdf");
  const [copyDoc, setCopyDoc] = useState<PDFDocumentProxy>();
  const [copySizes, setCopySizes] = useState<Size[]>([]);
  const [copyError, setCopyError] = useState("");
  const {questions, loading: questionsLoading, error: questionsError, changed: questionsChanged, unavailable, refresh: refreshQuestions, markChanged} = useQuestions(courseId, resourceId, fileId);
  const copy = useSearchableCopy(courseId, resourceId, fileId, csrfToken, pdfMode === "searchable");
  const [copyLoadCycle, setCopyLoadCycle] = useState(0);
  const changed = questionsChanged || copy.changed;
  const viewer = useRef<HTMLElement>(null);
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
  const [selectedError, setSelectedError] = useState("");
  const [selectedCycle, setSelectedCycle] = useState(0);
  const [askMode, setAskMode] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const composerGuard = useRef<() => boolean>(() => true);
  const openedAt = useRef(false);
  const switchingSurface = useRef(false);
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
        if (controller.signal.aborted) return;
        setResource(resource);
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

  useEffect(() => {
    if (unavailable) setMissing(true);
  }, [unavailable]);
  useEffect(() => {
    const element = viewer.current;
    if (!element) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = element.getBoundingClientRect().top;
        element.style.setProperty("--viewer-height", `${Math.max(240, window.innerHeight - Math.max(0, top))}px`);
      });
    };
    const observer = new ResizeObserver(measure);
    for (const el of document.querySelectorAll(".app-bar, .course-header, .slide-toolbar")) observer.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, {passive: true});
    measure();
    return () => {observer.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure);};
  }, [missing]);
  useEffect(() => {
    const url = copy.data?.status === "ready" ? copy.data.viewUrl : null;
    if (pdfMode !== "searchable" || !url || copy.changed) return;
    const controller = new AbortController();
    let owned: PDFDocumentProxy | undefined;
    setCopyError("");
    setCopyDoc(undefined);
    setCopySizes([]);
    void (async () => {
      try {
        const pdf = await loadPdfUrl(url, controller.signal);
        owned = pdf;
        const dimensions = await Promise.all(Array.from({length: pdf.numPages}, (_, index) => pdf.getPage(index + 1).then(page => page.getViewport({scale: 1}))));
        if (controller.signal.aborted) return;
        setCopySizes(dimensions.map(({width, height}) => ({width, height})));
        setCopyDoc(pdf);
      } catch (caught) {
        if (!controller.signal.aborted) setCopyError(caught instanceof Error ? caught.message : "The searchable copy couldn’t load.");
      }
    })();
    return () => {controller.abort(); if (owned) void owned.destroy();};
  }, [pdfMode, copy.data?.viewUrl, copy.data?.status, copy.changed, copyLoadCycle]);
  const displayDoc = pdfMode === "original" ? doc : copyDoc;
  const displaySizes = pdfMode === "original" ? sizes : copySizes;

  // Fit-to-width follows the frame's width.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry!.contentRect.width > 0) setFrameWidth(entry!.contentRect.width);
    });
    observer.observe(element);
    if (element.clientWidth > 0) setFrameWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [displayDoc, mobileTab]);
  const widest = Math.max(1, ...displaySizes.map((size) => size.width));
  const scale =
    zoom === "fit"
      ? Math.max(0.25, (frameWidth - 32) / widest)
      : (zoom * (frameWidth - 32 || widest)) / widest;

  // Render only pages near the visible area.
  useEffect(() => {
    const root = frame.current;
    if (!displayDoc || !root) return;
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
  }, [displayDoc, scale, mobileTab]);

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
    if (!root || !displayDoc || switchingSurface.current || (window.matchMedia("(max-width: 850px)").matches && mobileTab !== "pdf")) return;
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
    setSelectedPost(previous => previous?.id === selectedId ? previous : undefined);
    setSelectedError("");
    if (!selectedId) return;
    const controller = new AbortController();
    getPost(selectedId, controller.signal)
      .then((post) => {
        if (controller.signal.aborted) return;
        if ("deleted" in post && post.deleted === false) setSelectedPost(post);
        else {setSelectedPost(undefined); setSelectedError("This question is no longer available.");}
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        if (caught && typeof caught === "object" && "status" in caught && (caught.status === 401 || caught.status === 404)) setSelectedPost(undefined);
        setSelectedError("The question preview couldn’t load.");
      });
    return () => controller.abort();
  }, [selectedId, questions, selectedCycle]);
  const entries = useMemo(() => questions?.data ?? [], [questions]);
  const selected = entries.find((entry) => entry.id === selectedId);
  // A linked question selects its page once the list arrives.
  useEffect(() => {
    if (selected && doc && initialPostId === selected.id)
      goToPage(selected.page);
    // Only the first arrival of the linked question moves the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(selected && doc)]);

  useEffect(() => {
    if (!displayDoc || (window.matchMedia("(max-width: 850px)").matches && mobileTab !== "pdf")) return;
    const raf = requestAnimationFrame(() => {goToPage(Math.min(currentPage, displayDoc.numPages), false); switchingSurface.current = false;});
    return () => cancelAnimationFrame(raf);
    // Restore the reading position on a surface change, not on scroll events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayDoc, mobileTab, goToPage]);

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
    if (pdfMode !== "original" || changed) return;
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
  function changePdfMode(mode: "original" | "searchable") {
    if (mode !== pdfMode) {switchingSurface.current = true; setCopyDoc(undefined); setCopySizes([]);}
    setPdfMode(mode);
  }
  function askAbout(target: Selection) {
    if (changed || !active) return;
    changePdfMode("original");
    setPanel("questions");
    setMobileTab("questions");
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
    <section ref={viewer} className={`slide-viewer mobile-${mobileTab} panel-${panel}`} aria-labelledby="slide-viewer-title">
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
        <label className="slide-version">PDF version
          <select value={pdfMode} onChange={event => {changePdfMode(event.target.value as "original" | "searchable"); setAskMode(false); setDrag(undefined);}}>
            <option value="original">Original</option><option value="searchable">Searchable copy</option>
          </select>
        </label>
        <nav className="slide-pager" aria-label="Pages">
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Previous page"
            disabled={!displayDoc || currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            ‹
          </button>
          <label>
            <span className="visually-hidden">Page</span>
            <input
              inputMode="numeric"
              value={pageInput}
              disabled={!displayDoc}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => setPageInput(String(currentPage))}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !displayDoc) return;
                const page = Number(pageInput);
                if (Number.isInteger(page) && page >= 1 && page <= displayDoc.numPages)
                  goToPage(page);
                else setPageInput(String(currentPage));
              }}
            />
          </label>
          <span className="slide-page-count">of {displayDoc?.numPages ?? "…"}</span>
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Next page"
            disabled={!displayDoc || currentPage >= displayDoc.numPages}
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
            disabled={!displayDoc}
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
            disabled={!displayDoc}
            onClick={() => setZoom("fit")}
          >
            Fit width
          </button>
          <button
            type="button"
            className="slide-icon-button"
            aria-label="Zoom in"
            disabled={!displayDoc}
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
            disabled={changed || composing}
            onClick={() => {changePdfMode("original"); setMobileTab("pdf"); setAskMode(value => !value);}}
          >
            {askMode ? "Done marking" : "Mark an area"}
          </button>
        )}
        {fileId && (
          <a
            className="text-button slide-download"
            href={downloadPath(courseId, fileId)}
          >
            Download original
          </a>
        )}
        {copy.data?.status === "ready" && copy.data.viewUrl && <a className="text-button" href={copy.data.viewUrl} target="_blank" rel="noopener noreferrer">Open searchable PDF</a>}
        {copy.data?.status === "ready" && copy.data.downloadUrl && <a className="text-button" href={copy.data.downloadUrl}>Download searchable PDF</a>}
      </header>
      <nav className="slide-mobile-tabs" aria-label="Document panels">
        {([ ["pdf", "PDF"], ["questions", "Questions"], ["text", "Extracted text"] ] as const).map(([tab, label]) => <button type="button" key={tab} aria-pressed={mobileTab === tab} onClick={() => {setMobileTab(tab); if (tab !== "pdf") setPanel(tab);}}>{label}</button>)}
      </nav>
      {changed && <div className="slide-changed" role="status">These slides have changed. Your current view and draft have been kept. <button type="button" className="text-button" onClick={() => {if (!leave()) return; composerGuard.current = () => true; setComposing(false); setSelection(undefined); setSelectedId(undefined); changePdfMode("original"); openedAt.current = true; setCycle(value => value + 1);}}>Reload latest slides</button></div>}
      {pdfMode === "searchable" && <p className="slide-copy-note">This searchable copy may have less zoom detail. Marking an area or asking about a page returns to the original so questions stay aligned.</p>}
      <div className="slide-body">
        <div
          ref={frame}
          className={`slide-pages${askMode ? " marking" : ""}`}
          onScroll={trackPage}
          tabIndex={0}
          aria-label="Slides"
        >
          {pdfMode === "searchable" && !copyDoc ? (
            <div className="slide-status" role={copy.error || copyError || copy.data?.status === "failed" ? "alert" : "status"}>
              {copy.changed ? <p>These slides have changed. Reload to prepare their current copy.</p> : copy.error || copyError ? <><p>{copy.error || copyError}</p><button type="button" className="button secondary" onClick={() => {copy.retry(); setCopyLoadCycle(value => value + 1);}}>Try again</button></> : copy.data?.status === "not_requested" ? <><p>Prepare a searchable copy to select text while reading these pages.</p><button type="button" className="button primary" onClick={() => copy.retry(true)}>Prepare searchable copy</button></> : copy.data?.status === "failed" ? <><p>The searchable copy could not be prepared.</p><button type="button" className="button secondary" onClick={() => copy.retry(true)}>Try again</button></> : copy.stalled ? <><p>This is taking longer than expected.</p><button type="button" className="button secondary" onClick={() => copy.retry()}>Check again</button></> : <p>{copy.data?.status === "pending" ? "Preparing searchable copy…" : "Loading searchable copy…"}</p>}
              <button type="button" className="text-button" onClick={() => changePdfMode("original")}>Return to original</button>
            </div>
          ) : error && pdfMode === "original" ? (
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
          ) : !displayDoc ? (
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
            displaySizes.map((size, index) => {
              const number = index + 1;
              const width = size.width * scale;
              const height = size.height * scale;
              const onPage = pdfMode === "original" ? numbered.get(number) ?? [] : [];
              const offsets = markerOffsets(onPage.map((entry) => entry.box));
              const outline = pdfMode !== "original" ? undefined :
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
                    doc={displayDoc}
                    number={number}
                    size={size}
                    scale={scale}
                    near={near.has(number)}
                  />
                  {pdfMode === "searchable" && <SelectableText doc={displayDoc} page={number} scale={scale} near={near.has(number)} />}
                  {pdfMode === "original" && <div
                    className="slide-overlay"
                    onPointerDown={(event) => startDrag(event, number)}
                    onPointerMove={(event) => moveDrag(event, number)}
                    onPointerUp={(event) => endDrag(event, number)}
                    onPointerCancel={() => setDrag(undefined)}
                  />}
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
                          setPanel("questions"); setMobileTab("questions");
                          setSelectedId(entry.id);
                          setCurrentPage(number);
                          setPageInput(String(number));
                        }}
                      >
                        {position + 1}
                      </button>
                    );
                  })}
                  {active && pdfMode === "original" && !changed &&
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

        <aside className="slide-panel" aria-label="Document details">
          <nav className="slide-panel-tabs" aria-label="Side panel">
            <button type="button" aria-pressed={panel === "questions"} onClick={() => {setPanel("questions"); setMobileTab("questions");}}>Questions</button>
            <button type="button" aria-pressed={panel === "text"} onClick={() => {setPanel("text"); setMobileTab("text");}}>Extracted text</button>
          </nav>
          <div className="slide-text-content" hidden={panel !== "text"}>
            {resource && <ResourceExtractedText key={`${resource.fileId}:${cycle}`} courseId={courseId} resourceId={resourceId} name={title ?? resource.fileName ?? "Document"} mediaType="application/pdf" csrfToken={csrfToken} resource={resource} embedded visible={panel === "text" && (mobileTab === "text" || !window.matchMedia("(max-width: 850px)").matches)} />}
          </div>
          <div className="slide-question-content" hidden={panel !== "questions"}>
          {questionsLoading && !questions && <p role="status">Loading questions…</p>}
          {questionsError && <div role="alert"><p>{questions ? "Couldn’t refresh questions. Existing questions are still shown." : questionsError}</p><button type="button" className="text-button" onClick={() => void refreshQuestions()}>Retry questions</button></div>}
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
                onAnchorStale={markChanged}
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
                  {questions ? pageQuestions.length : "…"}
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
                    disabled={!doc || changed}
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
                          {selectedError && <div role="alert"><p>{selectedError}</p><button type="button" className="text-button" onClick={() => setSelectedCycle(value => value + 1)}>Retry preview</button></div>}
                          {selectedPost?.id === entry.id ? (
                            <div className="slide-question-preview">
                              <PostBody
                                bodyMarkdown={selectedPost.bodyMarkdown}
                              />
                            </div>
                          ) : !selectedError ? (
                            <p role="status" className="loading-line">
                              Loading question…
                            </p>
                          ) : null}
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
              ) : questions && !questionsLoading && !questionsError ? (
                <p className="slide-hint">No questions on this page yet.</p>
              ) : null}
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
          </div>
        </aside>
      </div>
    </section>
  );
}
