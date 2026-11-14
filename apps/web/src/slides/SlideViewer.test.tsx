import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// pdf.js needs a real canvas; the viewer is tested against a three-page fake.
const loadPdf = vi.fn();
vi.mock("./pdf.js", () => ({
  loadPdf: (...args: unknown[]) => loadPdf(...args),
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
    screen.getByRole("link", { name: "Download" }).getAttribute("href"),
  ).toBe("/api/v1/courses/c1/files/f1/download");
  expect(loadPdf).toHaveBeenCalledWith("c1", "f1", expect.any(Function));
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
  expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
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
