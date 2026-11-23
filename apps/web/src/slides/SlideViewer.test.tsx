import {
  act,
  waitFor,
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ConfirmProvider } from "../app/ConfirmDialog.js";
import { ProgressWatcher } from "../course-files/progress-watcher.js";

const render = (ui: ReactElement) =>
  testingRender(ui, { wrapper: ConfirmProvider });

// pdf.js needs a real canvas; the viewer is tested against a three-page fake.
const loadPdf = vi.fn();
const loadPdfUrl = vi.fn();
const textRender = vi.fn();
vi.mock("./pdf.js", () => ({
  loadPdf: (...args: unknown[]) => loadPdf(...args),
  loadPdfUrl: (...args: unknown[]) => loadPdfUrl(...args),
  TextLayer: class {
    render() {
      return textRender();
    }
    cancel() {}
  },
}));
vi.mock("./AnchorCrop.js", () => ({
  default: ({ label }: { label: string }) => (
    <figure role="img" aria-label={label} />
  ),
}));
const { default: SlideViewer } = await import("./SlideViewer.js");

const fakeDoc = {
  numPages: 3,
  getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 800 * scale,
      height: 600 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
  }),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
const resource = (mediaType = "application/pdf") => ({
  data: {
    id: "r1",
    courseId: "c1",
    kind: "upload",
    title: "Lecture 7",
    sectionId: null,
    visibility: "class",
    position: 0,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    fileId: "f1",
    fileName: "lecture.pdf",
    mediaType,
  },
});
const questions = {
  resourceId: "r1",
  fileId: "f1",
  data: [
    {
      id: "p1",
      type: "question",
      title: "Why rotate left?",
      page: 2,
      box,
      answered: true,
      unresolvedFollowups: 1,
      unread: false,
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "p2",
      type: "question",
      title: "Which case is this?",
      page: 2,
      box: { ...box, x: 0.5 },
      answered: false,
      unresolvedFollowups: 0,
      unread: true,
      createdAt: "2026-11-02T00:00:00Z",
    },
  ],
  earlierVersionCount: 2,
};
function stub(overrides: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn(async (input: string) => {
    for (const [path, respond] of Object.entries(overrides))
      if (input.endsWith(path)) return respond();
    if (input.endsWith("/resources/r1")) return json(resource());
    if (input.endsWith("/resources/r1/questions")) return json(questions);
    if (input.endsWith("/post-folders")) return json({ data: [] });
    if (input.endsWith("/posts/p1"))
      return json({
        data: {
          id: "p1",
          courseId: "c1",
          type: "question",
          deleted: false,
          title: "Why rotate left?",
          bodyMarkdown: "Where does **B** go?",
        },
      });
    return json({ data: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const props = {
  courseId: "c1",
  resourceId: "r1",
  csrfToken: "csrf",
  staff: false,
  active: true,
  onNavigate: vi.fn(),
};

beforeEach(() => {
  loadPdf.mockResolvedValue(fakeDoc);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  loadPdf.mockReset();
  loadPdfUrl.mockReset();
  textRender.mockReset();
  vi.restoreAllMocks();
});

it("opens on the linked page with navigation, zoom, and Download", async () => {
  stub();
  render(<SlideViewer {...props} initialPage={2} />);
  expect(
    await screen.findByRole("heading", { name: "Lecture 7" }),
  ).toBeTruthy();
  await screen.findAllByRole("group", { name: /^Page \d$/ });
  expect(screen.getAllByRole("group", { name: /^Page \d$/ })).toHaveLength(3);
  expect((screen.getByLabelText("Page") as HTMLInputElement).value).toBe("2");
  expect(screen.getByText("of 3")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Download original" })
      .getAttribute("href"),
  ).toBe("/api/v1/courses/c1/files/f1/download");
  expect(loadPdf).toHaveBeenCalledWith(
    "c1",
    "f1",
    expect.any(AbortSignal),
    expect.any(Function),
  );
});

it("shows one not-found state for a non-PDF resource without loading it", async () => {
  stub({ "/resources/r1": () => json(resource("text/plain")) });
  render(<SlideViewer {...props} />);
  expect(await screen.findByText("These slides aren't available")).toBeTruthy();
  expect(loadPdf).not.toHaveBeenCalled();
});

it("shows the same not-found state for a hidden resource", async () => {
  stub({
    "/resources/r1": () =>
      json(
        { error: { code: "not_found", message: "Resource is not found" } },
        404,
      ),
  });
  render(<SlideViewer {...props} />);
  expect(await screen.findByText("These slides aren't available")).toBeTruthy();
});

it("offers a retry and keeps Download when the PDF fails to load", async () => {
  stub();
  loadPdf.mockRejectedValueOnce(new Error("The slides could not be loaded."));
  const user = userEvent.setup();
  render(<SlideViewer {...props} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "could not be loaded",
  );
  expect(screen.getByRole("link", { name: "Download original" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findAllByRole("group", { name: /^Page \d$/ });
});

it("numbers labeled markers and lists the page's questions", async () => {
  stub();
  const user = userEvent.setup();
  render(<SlideViewer {...props} initialPage={2} initialPostId="p1" />);
  const page = await screen.findByRole("group", { name: "Page 2" });
  const first = await within(page).findByRole("button", {
    name: "Question 1 on page 2: Why rotate left?, answered",
  });
  expect(first.textContent).toBe("1");
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(
    within(page).getByRole("button", {
      name: "Question 2 on page 2: Which case is this?, unanswered",
    }),
  ).toBeTruthy();
  // The linked question's preview and its open followups.
  expect(await screen.findByText("B")).toBeTruthy();
  expect(screen.getByText("1 open followup")).toBeTruthy();
  const open = screen.getByRole("link", { name: "Open in Discussion" });
  await user.click(open);
  expect(props.onNavigate).toHaveBeenCalledWith("/courses/c1/posts/p1");
  expect(
    screen.getByText(
      "2 questions were asked on an earlier version of these slides.",
    ),
  ).toBeTruthy();
});

it("anchors a question to the whole page from the keyboard", async () => {
  stub();
  const user = userEvent.setup();
  render(<SlideViewer {...props} />);
  await screen.findAllByRole("group", { name: /^Page \d$/ });
  await user.click(screen.getByRole("button", { name: "Ask about this page" }));
  expect(
    screen.getByRole("heading", { name: "Ask about page 1" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("img", {
      name: "The marked area of Lecture 7, page 1",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("region", { name: "Create a post" })).toBeTruthy();
});

it("keeps a dragged box and offers to ask about it, ignoring clicks", async () => {
  stub();
  render(<SlideViewer {...props} />);
  const page = await screen.findByRole("group", { name: "Page 1" });
  const overlay = page.querySelector(".slide-overlay") as HTMLElement;
  overlay.setPointerCapture = () => {};
  overlay.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  const drag = (from: number[], to: number[]) => {
    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerType: "mouse",
      clientX: from[0],
      clientY: from[1],
    });
    fireEvent.pointerMove(overlay, { clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(overlay, { clientX: to[0], clientY: to[1] });
  };
  drag([100, 100], [101, 101]);
  expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
  drag([80, 120], [400, 300]);
  expect(
    await screen.findByRole("button", { name: "Ask about this" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Ask about this area" }),
  ).toBeTruthy();
});

it("closes asking in an archived course but keeps the slides readable", async () => {
  stub();
  render(<SlideViewer {...props} active={false} />);
  await screen.findAllByRole("group", { name: /^Page \d$/ });
  expect(
    screen.getByText("This course is archived, so new questions are closed."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Ask about this page" }),
  ).toBeNull();
});

it("refreshes pending embedded text when extraction completes", async () => {
  let completed = false;
  const subscribed = vi.spyOn(ProgressWatcher.prototype, "subscribe");
  const fetchMock = stub({
    "/resources/r1": () =>
      json({
        data: {
          ...resource().data,
          textStatus: completed ? "ready" : "pending",
        },
      }),
    "/resources/r1/text": () =>
      json({
        data: {
          fileId: "f1",
          status: completed ? "ready" : "pending",
          text: completed ? "Completed lecture" : null,
          truncated: false,
        },
      }),
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:text";
      }
      static revokeObjectURL() {}
    },
  );
  render(<SlideViewer {...props} initialPanel="text" />);
  await screen.findByText("Queued for extraction");
  await waitFor(() => expect(subscribed).toHaveBeenCalled());
  completed = true;
  fireEvent(document, new Event("visibilitychange"));
  expect(await screen.findByText("Completed lecture")).toBeTruthy();
  expect(
    await screen.findByRole("link", { name: "Download .txt" }),
  ).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith("/text")),
  ).toHaveLength(2);
});

it.each(["initial", "reopen", "retry"])(
  "rejects replacement text on %s without exposing a download",
  async (path) => {
    let reads = 0;
    stub({
      "/resources/r1/text": () => {
        reads++;
        if (path === "retry" && reads === 1)
          return json({ error: { message: "Temporary text error" } }, 503);
        return json({
          data: {
            fileId: path === "reopen" && reads === 1 ? "f1" : "f2",
            status: "ready",
            text:
              reads === 1 && path === "reopen"
                ? "Original lecture"
                : "Replacement lecture",
            truncated: false,
          },
        });
      },
    });
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:text";
        }
        static revokeObjectURL() {}
      },
    );
    const user = userEvent.setup();
    render(<SlideViewer {...props} initialPanel="text" />);
    if (path === "reopen") {
      await screen.findByText("Original lecture");
      await user.click(
        screen.getAllByRole("button", { name: "Questions" })[0]!,
      );
      await user.click(
        screen.getAllByRole("button", { name: "Extracted text" })[0]!,
      );
    }
    if (path === "retry")
      await user.click(
        await screen.findByRole("button", { name: "Try again" }),
      );
    await screen.findByText(
      "This file was replaced. Reload to read its extracted text.",
    );
    expect(screen.queryByText("Replacement lecture")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download .txt" })).toBeNull();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Text layout"), "original");
    expect(screen.queryByText("Replacement lecture")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download .txt" })).toBeNull();
  },
);

it.each([
  "original canvas",
  "searchable canvas",
  "text extraction",
  "text layer",
])(
  "retries %s failures without loading a different original",
  async (failure) => {
    let broken = true;
    const canvasRender = vi.fn(() => ({
      promise:
        broken && failure.includes("canvas")
          ? Promise.reject(new Error("Render failed"))
          : Promise.resolve(),
      cancel() {},
    }));
    const testDoc = {
      ...fakeDoc,
      destroy: async () => {},
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 800 * scale,
          height: 600 * scale,
        }),
        render: canvasRender,
        getTextContent: async () => {
          if (broken && failure === "text extraction")
            throw new Error("Render failed");
          return { items: [] };
        },
      }),
    };
    loadPdf.mockResolvedValue(testDoc);
    loadPdfUrl.mockResolvedValue({ ...testDoc });
    textRender.mockImplementation(async () => {
      if (broken && failure === "text layer") throw new Error("Render failed");
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    const observe = vi.fn();
    let observerCallback: IntersectionObserverCallback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = observe;
        disconnect() {}
      },
    );
    stub({
      "/resources/r1/searchable-pdf": () =>
        json({
          data: {
            fileId: "f1",
            status: "ready",
            viewUrl: "/copy",
            downloadUrl: "/copy-download",
            pageCount: 3,
          },
        }),
    });
    const user = userEvent.setup();
    render(<SlideViewer {...props} initialPage={2} />);
    await screen.findByRole("group", { name: "Page 2" });
    if (failure !== "original canvas") {
      await user.selectOptions(
        screen.getByLabelText("PDF version"),
        "searchable",
      );
      await waitFor(() => expect(loadPdfUrl).toHaveBeenCalled());
      await screen.findByRole("group", { name: "Page 2" });
    }
    await waitFor(() => expect(observerCallback).toBeTypeOf("function"));
    act(() =>
      observerCallback!(
        [
          {
            target: screen.getByRole("group", { name: "Page 2" }),
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    await screen.findByText("Render failed");
    broken = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("group", { name: "Page 2" });
    await waitFor(() => expect(canvasRender).toHaveBeenCalled());
    expect(screen.queryByText("Render failed")).toBeNull();
    expect(loadPdf).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Page")).toHaveProperty("value", "2");
  },
);

it("posts a restored announcement as an ordinary anchored note", async () => {
  const { Composer } = await import("../posts/views.js");
  const saved = {
    courseId: "c1",
    content: {
      type: "note",
      title: "Saved note",
      bodyMarkdown: "Lecture details",
      announcement: true,
      anonymous: false,
      tags: [],
    },
    version: 3,
    updatedAt: "2026-01-01",
  };
  const created = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/post-draft"))
      return new Response(JSON.stringify({ data: saved }), {
        headers: { "Content-Type": "application/json", ETag: '"v3"' },
      });
    if (init?.method === "POST" && url.endsWith("/posts"))
      return json({ data: { id: "new-note", type: "note" } }, 201);
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const anchor = { resourceId: "r1", fileId: "f1", page: 1, box };
  const view = render(
    <Composer
      courseId="c1"
      csrfToken="csrf"
      staff
      folders={[]}
      anchor={anchor}
      onCreated={created}
      onClose={() => {}}
      onDiscardLocalChanges={() => {}}
      onLeaveRequestChange={() => {}}
      onStateChange={() => {}}
    />,
  );
  await screen.findByText("Saved draft restored for this course.");
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(created).toHaveBeenCalled());
  const sent = fetchMock.mock.calls.find(
    ([url, init]) => url.endsWith("/posts") && init?.method === "POST",
  )!;
  expect(JSON.parse(String(sent[1]?.body))).toMatchObject({
    type: "note",
    title: "Saved note",
    anchor,
  });
  expect(JSON.parse(String(sent[1]?.body))).not.toHaveProperty("announcement");
  const save = fetchMock.mock.calls.find(
    ([url, init]) => url.endsWith("/post-draft") && init?.method === "PUT",
  )!;
  expect(save).toBeTruthy();
  expect(JSON.parse(String(save[1]?.body)).content).not.toHaveProperty(
    "announcement",
  );
});

it.each(["original", "searchable"])(
  "releases off-screen %s canvas buffers and redraws on return",
  async (mode) => {
    const draw = vi.fn(() => ({ promise: Promise.resolve(), cancel() {} }));
    const testDoc = {
      ...fakeDoc,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 800 * scale,
          height: 600 * scale,
        }),
        render: draw,
        getTextContent: async () => ({ items: [] }),
      }),
    };
    loadPdf.mockResolvedValue(testDoc);
    loadPdfUrl.mockResolvedValue({ ...testDoc });
    textRender.mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    let notify!: IntersectionObserverCallback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    stub({
      "/resources/r1/searchable-pdf": () =>
        json({
          data: {
            fileId: "f1",
            status: "ready",
            viewUrl: "/copy",
            downloadUrl: "/copy-download",
            pageCount: 3,
          },
        }),
    });
    const user = userEvent.setup();
    const view = render(<SlideViewer {...props} initialPage={2} />);
    await screen.findByRole("group", { name: "Page 2" });
    if (mode === "searchable") {
      await user.selectOptions(screen.getByLabelText("PDF version"), mode);
      await waitFor(() => expect(loadPdfUrl).toHaveBeenCalled());
    }
    const page = await screen.findByRole("group", { name: "Page 2" });
    const canvas = page.querySelector("canvas")!;
    const visible = (isIntersecting: boolean) =>
      act(() =>
        notify(
          [
            {
              target: page,
              isIntersecting,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        ),
      );
    visible(true);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(canvas.width).toBeGreaterThan(0);
    const width = canvas.style.width;
    const height = canvas.style.height;
    visible(false);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvas.style.width).toBe(width);
    expect(canvas.style.height).toBe(height);
    visible(true);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
    expect(canvas.width).toBeGreaterThan(0);
    expect(screen.getByLabelText("Page")).toHaveProperty("value", "2");
    const originalSignal = loadPdf.mock.calls[0]![2] as AbortSignal;
    const derivedSignal = loadPdfUrl.mock.calls[0]?.[1] as
      AbortSignal | undefined;
    view.unmount();
    expect(originalSignal.aborted).toBe(true);
    if (derivedSignal) expect(derivedSignal.aborted).toBe(true);
    expect(canvas.width).toBe(0);
  },
);

/** A document whose in-flight renders fail once its owner releases it, as pdf.js does on destroy. */
function releasableDoc(released: AbortSignal, draw = vi.fn()) {
  return {
    ...fakeDoc,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 800 * scale,
        height: 600 * scale,
      }),
      render: () => {
        draw();
        return {
          promise: new Promise((_, reject) =>
            released.addEventListener("abort", () => {
              const error = new Error("Rendering cancelled, page 2");
              error.name = "RenderingCancelledException";
              reject(error);
            }),
          ),
          cancel() {},
        };
      },
      getTextContent: () =>
        new Promise((_, reject) =>
          released.addEventListener("abort", () =>
            reject(new Error("Transport destroyed")),
          ),
        ),
    }),
  };
}

function trackNearPages() {
  let notify!: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  return async (name: string) => {
    await waitFor(() => expect(notify).toBeTypeOf("function"));
    act(() =>
      notify(
        [
          {
            target: screen.getByRole("group", { name }),
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
  };
}

it("reloads replaced slides without reporting the released document's cancelled renders", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  const show = trackNearPages();
  const staleDraw = vi.fn();
  const freshDraw = vi.fn(() => ({ promise: Promise.resolve(), cancel() {} }));
  loadPdf.mockImplementation(async (_course, fileId, signal: AbortSignal) =>
    fileId === "f1"
      ? releasableDoc(signal, staleDraw)
      : {
          ...fakeDoc,
          getPage: async () => ({
            getViewport: ({ scale }: { scale: number }) => ({
              width: 800 * scale,
              height: 600 * scale,
            }),
            render: freshDraw,
          }),
        },
  );
  let current = "f1";
  stub({
    "/resources/r1": () =>
      json({ data: { ...resource().data, fileId: current } }),
    "/resources/r1/questions": () =>
      json({ ...questions, fileId: "f2", data: [] }),
  });
  // DOM readiness can precede the passive effect that registers visibility.
  const signaled = new Promise<void>((resolve, reject) => {
    const attached = new MutationObserver(() => {
      if (!screen.queryByRole("group", { name: "Page 2" })) return;
      attached.disconnect();
      try {
        Promise.resolve(show("Page 2")).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
    attached.observe(document.body, { childList: true, subtree: true });
  });
  render(<SlideViewer {...props} initialPage={2} />);
  await signaled;
  await waitFor(() => expect(staleDraw).toHaveBeenCalled());
  current = "f2";
  const reload = await screen.findByRole("button", {
    name: "Reload latest slides",
  });
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    reload.click();
    await waitFor(() => expect(loadPdf).toHaveBeenCalledTimes(2));
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  }
  await screen.findByRole("group", { name: "Page 2" });
  await show("Page 2");
  await waitFor(() => expect(freshDraw).toHaveBeenCalled());
  expect(screen.queryByText(/Rendering cancelled/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

it("leaves and reopens the searchable copy without reporting its released document's failures", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  textRender.mockResolvedValue(undefined);
  const show = trackNearPages();
  const copyDraw = vi.fn();
  loadPdfUrl.mockImplementation(async (_url, signal: AbortSignal) =>
    releasableDoc(signal, copyDraw),
  );
  stub({
    "/resources/r1/searchable-pdf": () =>
      json({
        data: {
          fileId: "f1",
          status: "ready",
          viewUrl: "/copy",
          downloadUrl: "/copy-download",
          pageCount: 3,
        },
      }),
  });
  const user = userEvent.setup();
  render(<SlideViewer {...props} initialPage={2} />);
  await screen.findByRole("group", { name: "Page 2" });
  const version = screen.getByLabelText("PDF version");
  await user.selectOptions(version, "searchable");
  await waitFor(() => expect(loadPdfUrl).toHaveBeenCalledTimes(1));
  await screen.findByRole("group", { name: "Page 2" });
  await show("Page 2");
  await waitFor(() => expect(copyDraw).toHaveBeenCalled());
  await user.selectOptions(version, "original");
  await user.selectOptions(version, "searchable");
  await waitFor(() => expect(loadPdfUrl).toHaveBeenCalledTimes(2));
  await screen.findByRole("group", { name: "Page 2" });
  await show("Page 2");
  await waitFor(() => expect(copyDraw).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByText(/Rendering cancelled|Transport destroyed/),
  ).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
