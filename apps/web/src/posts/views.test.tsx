import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import katex from "katex";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMathAnalysis } from "./mathDiagnostics.js";
import { Discussion } from "./views.js";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const course = {
  id: "course-1",
  name: "Physics",
  status: "active" as const,
  organizationId: "org-1",
  joinCode: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  version: 1,
};
const post = (id: string, title: string) => ({
  id,
  courseId: course.id,
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: "A useful explanation about cutoffs and deadlines.",
  author: {
    userId: null,
    displayName: "Anonymous",
    anonymous: true,
    deleted: false,
  },
  anonymous: true,
  tags: [],
  createdAt: "2026-01-01",
  lastActivityAt: "2026-01-01",
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const page = (posts: unknown[], cursor: string | null = null) =>
  json({ data: posts, page: { nextCursor: cursor, hasMore: !!cursor } });
beforeEach(() => {
  class AnalysisWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage({ version, source }: { version: number; source: string }) {
      queueMicrotask(() =>
        this.onmessage?.({ data: { version, ...getMathAnalysis(source) } }),
      );
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", AnalysisWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("offers formatting controls and previews the unsent post body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Equation",
  );
  await user.click(screen.getByRole("button", { name: "Bold" }));
  expect(
    screen.getByRole("textbox", { name: "Post body" }).textContent,
  ).toContain("****");
  await user.keyboard("$x^2$");
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(
    screen
      .getByRole("region", { name: "Post body preview" })
      .querySelector("strong .katex"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Write" }));
  expect(screen.getByRole("textbox", { name: "Post title" })).toHaveProperty(
    "value",
    "Equation",
  );
});

it.each([
  ["Bold", "**ptr**"],
  ["Italic", "*ptr*"],
  ["Inline code", "`ptr`"],
  ["Inline math", "$ptr$"],
])("wraps a real editor selection with %s syntax", async (button, expected) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "ptr");
  await user.keyboard(`{Shift>}${"{ArrowLeft}".repeat(3)}{/Shift}`);
  await user.click(screen.getByRole("button", { name: button }));
  expect(body.textContent).toBe(expected);
  expect(document.activeElement).toBe(body);
});

it("places the link destination under the caret for immediate typing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "notes");
  await user.keyboard(`{Shift>}${"{ArrowLeft}".repeat(5)}{/Shift}`);
  await user.click(screen.getByRole("button", { name: "Link" }));
  expect(body.textContent).toBe("[notes](url)");
  await user.keyboard("https://example.edu");
  expect(body.textContent).toBe("[notes](https://example.edu)");
});

it.each([
  ["Heading", "### one\n### two"],
  ["Bulleted list", "- one\n- two"],
  ["Numbered list", "1. one\n2. two"],
  ["Block math", "$$\none\ntwo\n$$"],
])("formats selected lines with %s in the editor", async (button, expected) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "one{enter}two");
  await user.keyboard(`{Shift>}${"{ArrowLeft}".repeat(7)}{/Shift}`);
  await user.click(screen.getByRole("button", { name: button }));
  expect(
    Array.from(
      body.querySelectorAll(".cm-line"),
      (line) => line.textContent,
    ).join("\n"),
  ).toBe(expected);
  expect(document.activeElement).toBe(body);
});

it("inserts math at the editor caret and removes a live LaTeX error when corrected", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.click(screen.getByRole("button", { name: "Inline math" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  expect(document.activeElement).toBe(body);
  await user.keyboard("\\badcommand");
  expect(body.textContent).toBe("$\\badcommand$");
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toContain(
    "LaTeX at position",
  );
  expect(body.querySelector(".invalid-math")).toBeTruthy();
  await user.keyboard(`{Shift>}${"{ArrowLeft}".repeat(11)}{/Shift}x^2`);
  expect(body.textContent).toBe("$x^2$");
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toBe("");
  expect(body.querySelector(".invalid-math")).toBeNull();
});

it("renders complete inline math in the editable body and reveals source on activation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math .katex")).toBeTruthy(),
  );
  await user.click(body.querySelector(".post-editor-math")!);
  expect(body.querySelector(".post-editor-math")).toBeNull();
  expect(body.textContent).toContain("$x^2$ tail");
  expect(document.activeElement).toBe(body);
});

it("renders standalone block math and reveals its source when a selection reaches it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$${enter}x^2{enter}$${enter}tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math .katex-display")).toBeTruthy(),
  );
  await user.keyboard("{Control>}{a}{/Control}");
  expect(body.querySelector(".post-editor-math")).toBeNull();
  expect(body.textContent).toContain("$$");
});

it("reveals inline source when the keyboard caret reaches either formula boundary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "a $x^2$ z");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
  expect(body.querySelector(".post-editor-math")).toBeNull();
  expect(body.textContent).toBe("a $x^2$ z");
});

it("shows source and an accessible error when rendered math becomes invalid, then rerenders after correction", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  await user.click(body.querySelector(".post-editor-math")!);
  await user.keyboard("{Control>}{a}{/Control}$\\badcommand$ tail");
  expect(body.querySelector(".post-editor-math")).toBeNull();
  await waitFor(() => expect(body.querySelector(".invalid-math")).toBeTruthy());
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toContain(
    "LaTeX at position",
  );
  await user.keyboard("{Control>}{a}{/Control}$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toBe("");
});

it("submits the original math Markdown even while its formula is rendered in the editor", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? json({ data: post("new-post", "Math question") }, 201)
      : page([]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Math question",
  );
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true),
  );
  const create = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )!;
  expect(JSON.parse(create[1]?.body as string).bodyMarkdown).toBe("$x^2$ tail");
});

it("publishes the exact indented Markdown body with trailing whitespace", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? json({ data: post("new-post", "Code") }, 201)
      : page([]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(screen.getByRole("textbox", { name: "Post title" }), "Code");
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "    code  ");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true),
  );
  const create = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )!;
  expect(JSON.parse(create[1]?.body as string).bodyMarkdown).toBe("    code  ");
});

it("rejects a whitespace-only Markdown body", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => page([]));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(screen.getByRole("textbox", { name: "Post title" }), "Code");
  await user.type(screen.getByRole("textbox", { name: "Post body" }), "    ");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "Post body must be between 1 and 100,000 characters.",
  );
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});

it("copies, pastes, and undoes formula source rather than rendered math", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  await user.keyboard("{Control>}{a}{/Control}");
  const clipboard = await user.copy();
  expect(clipboard?.getData("text/plain")).toBe("$x^2$ tail");
  await user.keyboard("{ArrowRight}");
  await user.paste(" $y^2$");
  await user.keyboard("{Control>}{a}{/Control}");
  expect((await user.copy())?.getData("text/plain")).toBe("$x^2$ tail $y^2$");
  await user.keyboard("{Control>}{z}{/Control}");
  await user.keyboard("{Control>}{a}{/Control}");
  expect((await user.copy())?.getData("text/plain")).toBe("$x^2$ tail");
});

it("applies toolbar syntax at the raw caret after a rendered formula is opened", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() =>
    expect(body.querySelector(".post-editor-math")).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Edit inline math" }));
  await user.click(screen.getByRole("button", { name: "Bold" }));
  expect(body.textContent).toBe("$****x^2$ tail");
  expect(document.activeElement).toBe(body);
});

it("ignores older worker diagnostics after the author edits the body again", async () => {
  type Reply = {
    version: number;
    diagnostics: { from: number; to: number; message: string }[];
    formulas?: {
      from: number;
      to: number;
      tex: string;
      displayMode: boolean;
    }[];
  };
  const messages: { version: number; source: string }[] = [];
  let emit: (event: { data: Reply }) => void = () => {};
  class FakeWorker {
    onmessage: ((event: { data: Reply }) => void) | null = null;
    postMessage(message: { version: number; source: string }) {
      messages.push(message);
      emit = (event) => this.onmessage?.(event);
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$\\badcommand$");
  const old = messages.at(-1)!;
  expect(messages).toHaveLength(old.source.length);
  await user.keyboard("x");
  const latest = messages.at(-1)!;
  expect(latest.version).toBeGreaterThan(old.version);
  emit({
    data: {
      version: old.version,
      diagnostics: [{ from: 0, to: old.source.length, message: "Old error" }],
    },
  });
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).not.toContain(
    "Old error",
  );
  emit({ data: { version: latest.version, diagnostics: [] } });
  expect(body.querySelector(".invalid-math")).toBeNull();
  emit({
    data: {
      version: old.version,
      diagnostics: [],
      formulas: [{ from: 0, to: 5, tex: "x^2", displayMode: false }],
    },
  });
  expect(body.querySelector(".post-editor-math")).toBeNull();
});

it("keeps the post body editable if LaTeX checking fails", async () => {
  class BrokenWorker {
    postMessage() {
      throw new Error("worker unavailable");
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", BrokenWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "Still editable");
  expect(body.textContent).toBe("Still editable");
  await user.keyboard("!");
  expect(body.textContent).toBe("Still editable!");
  await user.keyboard(" $x^2$ $\\badcommand$");
  expect(body.textContent).toBe("Still editable! $x^2$ $\\badcommand$");
  expect(body.querySelector(".post-editor-math, .invalid-math")).toBeNull();
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toContain(
    "unavailable",
  );
});

it("keeps raw Markdown editable when the math worker cannot be constructed", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("worker unavailable");
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ $\\badcommand$");
  expect(body.textContent).toBe("$x^2$ $\\badcommand$");
  expect(body.querySelector(".post-editor-math, .invalid-math")).toBeNull();
  expect(screen.getByLabelText("LaTeX diagnostics").textContent).toContain(
    "unavailable",
  );
});

it("reveals previously rendered source if the math worker later fails", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    last: { version: number; source: string } | null = null;
    constructor() {
      workers.push(this);
    }
    postMessage(message: { version: number; source: string }) {
      this.last = message;
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  const activeWorker = workers.at(-1)!;
  activeWorker.onmessage?.({
    data: {
      version: activeWorker.last!.version,
      diagnostics: [],
      formulas: [{ from: 0, to: 5, tex: "x^2", displayMode: false }],
    },
  });
  expect(body.querySelector(".post-editor-math")).toBeTruthy();
  activeWorker.onerror?.();
  expect(body.querySelector(".post-editor-math")).toBeNull();
  expect(body.textContent).toBe("$x^2$ tail");
  activeWorker.onmessage?.({
    data: {
      version: activeWorker.last!.version,
      diagnostics: [],
      formulas: [{ from: 0, to: 5, tex: "x^2", displayMode: false }],
    },
  });
  expect(body.querySelector(".post-editor-math")).toBeNull();
  await waitFor(() =>
    expect(screen.getByLabelText("LaTeX diagnostics").textContent).toContain(
      "unavailable",
    ),
  );
  await user.keyboard("{End} $y^2$");
  expect(body.textContent).toBe("$x^2$ tail $y^2$");
  expect(body.querySelector(".post-editor-math, .invalid-math")).toBeNull();
});

it("reveals raw source when the external math renderer fails in the editor", async () => {
  vi.spyOn(katex, "render").mockImplementation(() => {
    throw new Error("DOM rendering unavailable");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  const body = screen.getByRole("textbox", { name: "Post body" });
  await user.type(body, "$x^2$ tail");
  await waitFor(() => expect(body.textContent).toBe("$x^2$ tail"));
  expect(body.querySelector(".post-editor-math")).toBeNull();
});

it("keeps the controls above a focusable scroll region for posts and duplicates", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      return page([post("p1", "First")], "next");
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={vi.fn()}
    />,
  );
  const feed = screen.getByRole("region", { name: "Posts" });
  const listings = await screen.findByRole("region", { name: "Post listings" });
  expect(listings.getAttribute("tabindex")).toBe("0");
  expect(within(listings).getByText("First")).toBeTruthy();
  expect(
    within(listings).getByRole("button", { name: "Load more posts" }),
  ).toBeTruthy();
  expect(within(listings).queryByRole("searchbox")).toBeNull();
  expect(
    within(listings).queryByRole("button", { name: "Create post" }),
  ).toBeNull();
  expect(
    within(feed).getByRole("searchbox", { name: "Search posts" }),
  ).toBeTruthy();
  await user.selectOptions(
    within(feed).getByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  expect(
    within(listings).getByRole("button", { name: "Old question" }),
  ).toBeTruthy();
});

it("lets staff review merged posts without exposing their body and unmerge one", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      if (url.endsWith("/posts/merged-1/duplicate-review"))
        return json({
          data: {
            ...post("merged-1", "Old question"),
            bodyMarkdown: "Private retained body",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            version: 2,
          },
        });
      if (init?.method === "PATCH")
        return json({ data: post("merged-1", "Old question") });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={vi.fn()}
    />,
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  expect(await screen.findByText("Old question")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Canonical question" })).toBeTruthy();
  expect(screen.queryByText("Private retained body")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Old question" }));
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Post detail" }).textContent,
    ).toContain("Canonical question"),
  );
  await user.click(
    screen.getByRole("button", { name: "Unmerge Old question" }),
  );
  await waitFor(() =>
    expect(calls.some((call) => call === "PATCH /api/v1/posts/merged-1")).toBe(
      true,
    ),
  );
  expect(calls.some((call) => call.includes("duplicateStatus=confirmed"))).toBe(
    true,
  );
});

it("opens a duplicate card's canonical post in a new tab without replacing review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      if (url.endsWith("/posts/merged-1/duplicate-review"))
        return json({
          data: {
            ...post("merged-1", "Old question"),
            bodyMarkdown: "Private retained body",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            version: 2,
          },
        });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={onNavigate}
    />,
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  const canonicalLink = await screen.findByRole("link", {
    name: "Canonical question",
  });
  const card = canonicalLink.closest(".post-card");
  expect(card?.textContent?.replace(/\s+/g, " ").trim()).toBe(
    "Old questionMerged into Canonical question",
  );
  expect(card?.textContent).not.toContain("Merged duplicate");
  expect(card?.textContent).not.toContain("Private retained body");
  expect(canonicalLink.getAttribute("href")).toBe(
    "/courses/course-1/posts/canonical-1",
  );
  expect(canonicalLink.getAttribute("target")).toBe("_blank");
  expect(canonicalLink.getAttribute("rel")).toBe("noopener noreferrer");
  await user.click(screen.getByRole("button", { name: "Old question" }));
  expect(await screen.findByText("Private retained body")).toBeTruthy();
  await user.click(canonicalLink);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.getByText("Private retained body")).toBeTruthy();
});

it("shows the selected duplicate's retained detail instead of the canonical post", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      if (url.endsWith("/posts/merged-1/duplicate-review"))
        return json({
          data: {
            ...post("merged-1", "Old question"),
            bodyMarkdown: "Private retained body with $x^2$",
            tags: ["cutoffs"],
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            version: 3,
          },
        });
      if (url.endsWith("/posts/merged-1") && init?.method === "PATCH")
        return json({ data: post("merged-1", "Old question") });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      postId="canonical-1"
      onNavigate={vi.fn()}
    />,
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  await user.click(await screen.findByRole("button", { name: "Old question" }));
  const card = screen
    .getByRole("button", { name: "Old question" })
    .closest(".post-card");
  expect(card?.classList.contains("post-card")).toBe(true);
  expect(card?.classList.contains("selected")).toBe(true);
  const detail = screen.getByRole("region", { name: "Post detail" });
  expect(detail.textContent).toContain("Private retained body");
  expect(detail.querySelector(".katex")).toBeTruthy();
  expect(detail.textContent).toContain("cutoffs");
  expect(detail.textContent).toContain("Canonical question");
  expect(detail.textContent).not.toContain("Canonical body");
  expect(
    screen.queryByRole("button", { name: "Merge as duplicate" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Unmerge Old question" }),
  );
  await waitFor(() =>
    expect(
      calls.some(
        ({ url, init }) =>
          url === "/api/v1/posts/merged-1" &&
          init?.method === "PATCH" &&
          (init.headers as Record<string, string>)["If-Match"] === '"v3"',
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(detail.textContent).not.toContain("Private retained body"),
  );
});

it("does not show a late duplicate review after switching back to posts", async () => {
  let finishReview: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      if (url.endsWith("/posts/merged-1/duplicate-review"))
        return new Promise<Response>((resolve) => {
          finishReview = resolve;
        });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={vi.fn()}
    />,
  );
  const picker = await screen.findByRole("combobox", { name: "Post view" });
  await user.selectOptions(picker, "Duplicate posts");
  await user.click(await screen.findByRole("button", { name: "Old question" }));
  await waitFor(() => expect(finishReview).toBeDefined());
  await user.selectOptions(picker, "Posts");
  finishReview!(
    json({
      data: {
        ...post("merged-1", "Old question"),
        bodyMarkdown: "Secret retained text",
      },
    }),
  );
  await screen.findByText("No posts found.");
  expect(screen.queryByText("Secret retained text")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Merge as duplicate" }),
  ).toBeNull();
});

it("does not offer merged-post review to students", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/members/user-student")
        ? json({ data: { role: "student" } })
        : page([]),
    ),
  );
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-student"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("No posts found.");
  expect(screen.queryByRole("combobox", { name: "Post view" })).toBeNull();
});

it("only offers merging while staff are viewing posts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.endsWith("/posts/source-1"))
        return json({
          data: { ...post("source-1", "Cutoff question"), version: 1 },
        });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      postId="source-1"
      onNavigate={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Merge as duplicate" }),
  ).toBeTruthy();
  const postView = screen.getByRole("combobox", { name: "Post view" });
  await user.selectOptions(postView, "Duplicate posts");
  expect(
    screen.getByRole("heading", { name: "Select a duplicate post" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Merge as duplicate" }),
  ).toBeNull();
  await user.selectOptions(postView, "Posts");
  expect(
    screen.getByRole("button", { name: "Merge as duplicate" }),
  ).toBeTruthy();
});

it("navigates an old merged-post route to its canonical post", async () => {
  const redirected = json({ data: post("canonical-1", "Canonical question") });
  Object.defineProperties(redirected, {
    redirected: { value: true },
    url: { value: "https://app.example.edu/api/v1/posts/canonical-1" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/posts/merged-1") ? redirected : page([]),
    ),
  );
  const onNavigate = vi.fn();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      postId="merged-1"
      onNavigate={onNavigate}
    />,
  );
  await waitFor(() =>
    expect(onNavigate).toHaveBeenCalledWith(
      "/courses/course-1/posts/canonical-1",
    ),
  );
  expect(screen.queryByText("Old merged body")).toBeNull();
});

it("lets staff find a canonical post and confirm a merge from post detail", async () => {
  const source = { ...post("source-1", "Old cutoff question"), version: 1 };
  const target = { ...post("target-1", "Course cutoff guide"), version: 1 };
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.endsWith("/posts/source-1") && init?.method === "PATCH")
        return json({
          data: {
            id: "source-1",
            courseId: course.id,
            duplicateStatus: "confirmed",
            duplicateOfPostId: "target-1",
            version: 2,
          },
        });
      if (url.endsWith("/posts/source-1")) return json({ data: source });
      if (url.includes("q=cutoff")) return page([source, target]);
      return page([source, target]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      postId="source-1"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "Merge as duplicate" }),
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Find canonical post" }),
    "cutoff",
  );
  const candidateLink = await screen.findByRole("link", {
    name: "Course cutoff guide",
  });
  expect(candidateLink.getAttribute("href")).toBe(
    "/courses/course-1/posts/target-1",
  );
  expect(candidateLink.getAttribute("target")).toBe("_blank");
  expect(candidateLink.getAttribute("rel")).toBe("noopener noreferrer");
  await user.click(candidateLink);
  expect(screen.getByText("Merge into Course cutoff guide")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Confirm merge" }));
  await waitFor(() =>
    expect(
      calls.some(
        ({ url, init }) =>
          url.endsWith("/posts/source-1") &&
          init?.method === "PATCH" &&
          init.headers &&
          "If-Match" in init.headers &&
          init.headers["If-Match"] === '"v1"' &&
          init.body ===
            JSON.stringify({
              duplicateStatus: "confirmed",
              duplicateOfPostId: "target-1",
            }),
      ),
    ).toBe(true),
  );
});

it("keeps search syntax accessible without showing explanatory copy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1") ? json({ data: course }) : page([]),
    ),
  );
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("searchbox", { name: "Search posts" });
  expect(screen.queryByText("Questions and notes from your course")).toBeNull();
  const searchbox = screen.getByRole("searchbox", { name: "Search posts" });
  const description = document.getElementById(
    searchbox.getAttribute("aria-describedby") ?? "",
  );
  expect(description?.textContent).toBe(
    'Search words, "quoted phrases", OR, or -excluded terms.',
  );
  expect(description?.classList.contains("visually-hidden")).toBe(true);
});

it("searches live after 300 ms, preserves syntax, and removes the Search button", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("/posts?"))
        return page([
          post("p2", "Cutoffs for the course"),
          post("p1", "Other cutoff"),
        ]);
      return page([post("p1", "Other cutoff")]);
    }),
  );
  const replaceQuery = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query={undefined}
      postId={undefined}
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  await screen.findByText("Other cutoff");
  expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  await user.type(
    screen.getByRole("searchbox", { name: "Search posts" }),
    " A cutoff ",
  );
  expect(replaceQuery).not.toHaveBeenCalled();
  await waitFor(() => expect(replaceQuery).toHaveBeenCalledWith("A cutoff"));
  expect(calls.some((url) => url.includes("q=A+cutoff&sort=relevance"))).toBe(
    false,
  );
});

it("clears a live search immediately and retains the unfiltered feed", async () => {
  const replaceQuery = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([post("p1", "Matched")]),
    ),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="cutoff"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  await screen.findByText("Matched");
  await user.clear(screen.getByRole("searchbox", { name: "Search posts" }));
  expect(replaceQuery).toHaveBeenCalledWith("");
});

it("does not replace newer typing with an earlier debounced URL update", async () => {
  const replaceQuery = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1") ? json({ data: course }) : page([]),
    ),
  );
  const view = render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  const search = screen.getByRole("searchbox", { name: "Search posts" });
  fireEvent.change(search, { target: { value: "cutoff" } });
  await waitFor(() => expect(replaceQuery).toHaveBeenCalledWith("cutoff"));
  fireEvent.change(search, { target: { value: "cutoffs" } });
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="cutoff"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  expect(search).toHaveProperty("value", "cutoffs");
});

it("does not replace new typing after a clear with the delayed empty URL query", async () => {
  const replaceQuery = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1") ? json({ data: course }) : page([]),
    ),
  );
  const view = render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="old"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  const search = screen.getByRole("searchbox", { name: "Search posts" });
  fireEvent.change(search, { target: { value: "" } });
  expect(replaceQuery).toHaveBeenCalledWith("");
  fireEvent.change(search, { target: { value: "new" } });
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  expect(search).toHaveProperty("value", "new");
});

it("bounds the live query to 500 characters", async () => {
  const replaceQuery = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1") ? json({ data: course }) : page([]),
    ),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      onNavigate={vi.fn()}
      onQueryChange={replaceQuery}
    />,
  );
  await screen.findByRole("searchbox", { name: "Search posts" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search posts" }), {
    target: { value: "x".repeat(501) },
  });
  expect(
    (
      screen.getByRole("searchbox", {
        name: "Search posts",
      }) as HTMLInputElement
    ).value.length,
  ).toBeLessThanOrEqual(500);
  await waitFor(() => expect(replaceQuery).toHaveBeenCalled());
  expect(replaceQuery.mock.lastCall?.[0].length).toBe(500);
});

it("retains first-page cards and retries the same cursor without duplicates", async () => {
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("cursor=next"))
        return ++next === 1
          ? json({ error: { message: "Later unavailable" } }, 503)
          : page([post("p1", "First"), post("p2", "Second")]);
      return page([post("p1", "First")], "next");
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByText("First");
  await user.click(screen.getByRole("button", { name: "Load more posts" }));
  await screen.findByText("Later unavailable");
  await user.click(screen.getByRole("button", { name: "Retry loading posts" }));
  await screen.findByText("Second");
  expect(screen.getAllByText("First")).toHaveLength(1);
});

it("discards an old cursor response when a new live query begins", async () => {
  let releaseOld!: (response: Response) => void;
  const oldPage = new Promise<Response>((resolve) => {
    releaseOld = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("cursor=old-cursor")) return oldPage;
      if (url.includes("q=new")) return page([post("new", "New result")]);
      return page([post("old", "Old result")], "old-cursor");
    }),
  );
  const user = userEvent.setup();
  const view = render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="old"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Old result");
  await user.click(screen.getByRole("button", { name: "Load more posts" }));
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="new"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("New result");
  releaseOld(page([post("late", "Late old result")]));
  await waitFor(() => expect(screen.queryByText("Late old result")).toBeNull());
  expect(
    screen.queryByRole("button", { name: "Loading more posts…" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();
});

it("offers retry after an initial feed error", async () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      return ++attempts === 1
        ? json({ error: { message: "Feed unavailable" } }, 503)
        : page([post("p1", "Recovered")]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByText("Feed unavailable");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Recovered");
});

it("opens the composer in the detail panel and restores the selected post when closed empty", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/p1"))
        return json({ data: post("p1", "Selected question") });
      return page([post("p1", "Selected question")]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="p1"
      onNavigate={vi.fn()}
    />,
  );
  const detail = screen.getByRole("region", { name: "Post detail" });
  await screen.findByRole("heading", { name: "Selected question" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  expect(
    detail.contains(screen.getByRole("textbox", { name: "Post title" })),
  ).toBe(true);
  expect(
    screen.queryByRole("heading", { name: "Selected question" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close composer" }));
  expect(
    screen.getByRole("heading", { name: "Selected question" }),
  ).toBeTruthy();
});

it("asks before discarding a draft when selecting a post or closing the composer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([post("p1", "First question")]),
    ),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={navigate} />,
  );
  await screen.findByText("First question");
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(screen.getByRole("textbox", { name: "Post title" }), "Draft");
  await user.click(screen.getByRole("link", { name: /First question/ }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Post title" })).toHaveProperty(
    "value",
    "Draft",
  );
  await user.click(screen.getByRole("button", { name: "Close composer" }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "Post title" })).toBeTruthy();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("link", { name: /First question/ }));
  expect(navigate).toHaveBeenCalledWith("/courses/course-1/posts/p1");
  expect(screen.queryByRole("textbox", { name: "Post title" })).toBeNull();
});

it("shows a mobile Back to posts action for the composer and confirms draft discard", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1") ? json({ data: course }) : page([]),
    ),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  expect(
    document
      .querySelector(".discussion-columns")
      ?.classList.contains("has-selection"),
  ).toBe(true);
  await user.type(
    screen.getByRole("textbox", { name: "Post body" }),
    "Draft body",
  );
  await user.click(screen.getByRole("button", { name: /Back to posts/ }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Post body" }).textContent).toBe(
    "Draft body",
  );
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: /Back to posts/ }));
  expect(screen.queryByRole("textbox", { name: "Post body" })).toBeNull();
});

it("keeps a failed creation draft and navigates to the returned post after retry", async () => {
  let creates = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/courses/course-1") && init?.method !== "POST")
      return json({ data: course });
    if (init?.method === "POST")
      return ++creates === 1
        ? json({ error: { message: "Try again" } }, 503)
        : json({ data: post("new-post", "My question") }, 201);
    return page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={navigate} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "My question",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Post body" }),
    "Please explain it",
  );
  await user.keyboard(" ");
  await user.click(screen.getByRole("button", { name: "Inline math" }));
  await user.keyboard("x^2");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await screen.findByText("Try again");
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toBe("My question");
  expect(screen.getByRole("textbox", { name: "Post body" }).textContent).toBe(
    "Please explain it $x^2$",
  );
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/courses/course-1/posts/new-post"),
  );
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(JSON.parse(posts[0]?.[1]?.body as string).bodyMarkdown).toBe(
    "Please explain it $x^2$",
  );
  expect(posts[0]?.[1]?.headers).toMatchObject({
    "X-CSRF-Token": "csrf",
    "Idempotency-Key": expect.any(String),
  });
  expect(posts[0]?.[1]?.headers).toEqual(posts[1]?.[1]?.headers);
});

it("prevents a second create while the first request is pending", async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/courses/course-1") && init?.method !== "POST")
      return json({ data: course });
    if (init?.method === "POST") return pending;
    return page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Waiting",
  );
  await user.type(screen.getByRole("textbox", { name: "Post body" }), "Body");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  expect(
    (screen.getByRole("button", { name: "Publishing…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  complete(json({ data: post("p1", "Waiting") }, 201));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Publishing…" })).toBeNull(),
  );
});

it("uses submitted search text and server relevance order without parsing syntax", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([post("p2", "Second result"), post("p1", "First result")]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query={'"office hours" OR cutoff -friday'}
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Second result");
  const cards = screen
    .getAllByRole("link")
    .filter((link) => link.className.includes("post-card"));
  expect(cards.map((card) => card.textContent)).toEqual([
    expect.stringContaining("Second result"),
    expect.stringContaining("First result"),
  ]);
  expect(
    new URL(
      urls.find((url) => url.includes("/posts?"))!,
      "https://example.edu",
    ).searchParams.get("q"),
  ).toBe('"office hours" OR cutoff -friday');
  expect(urls.some((url) => url.includes("sort=relevance"))).toBe(true);
});

it("renders Markdown and LaTeX in feed cards without nested links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([
            {
              ...post("p1", "Formatted question"),
              bodyMarkdown:
                "**cutoff** is $x^2$; see [notes](https://example.edu/notes) and ![diagram](https://example.edu/diagram.png)",
            },
          ]),
    ),
  );
  const onNavigate = vi.fn();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      onNavigate={onNavigate}
    />,
  );
  const card = await screen.findByRole("link", { name: /Formatted question/ });
  expect(card.querySelector(".post-card-preview strong")?.textContent).toBe(
    "cutoff",
  );
  expect(card.querySelector(".post-card-preview .katex")).toBeTruthy();
  expect(card.querySelector(".post-card-preview")?.textContent).toContain(
    "notes",
  );
  expect(card.querySelector(".post-card-preview a")).toBeNull();
  expect(card.querySelector(".post-card-preview img")).toBeNull();
  expect(card.querySelector(".post-card-preview")?.textContent).toContain(
    "diagram",
  );
  await userEvent.setup().click(card);
  expect(onNavigate).toHaveBeenCalledWith("/courses/course-1/posts/p1");
});

it("renders Markdown and LaTeX in related questions without nested links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("type=question"))
        return page([
          {
            ...post("p1", "Related formula"),
            bodyMarkdown:
              "**cutoff** is $x^2$; see [notes](https://example.edu/notes) and ![diagram](https://example.edu/diagram.png)",
          },
        ]);
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Formula cutoff",
  );
  const card = await screen.findByRole("link", { name: /Related formula/ });
  expect(card.querySelector(".post-card-preview strong")?.textContent).toBe(
    "cutoff",
  );
  expect(card.querySelector(".post-card-preview .katex")).toBeTruthy();
  expect(card.querySelector(".post-card-preview a")).toBeNull();
  expect(card.querySelector(".post-card-preview img")).toBeNull();
});

it("shows a direct post with viewer-projected author and blocks hostile Markdown HTML", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/p1"))
        return json({
          data: {
            ...post("p1", "Safe post"),
            bodyMarkdown:
              "<script>alert(1)</script>\n\n[bad](javascript:alert(1)) **good** and $x^2$",
          },
        });
      return page([]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="p1"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Safe post" });
  expect(screen.getByText("Anonymous")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(screen.getByText("good")).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Post detail" }).querySelector(".katex"),
  ).toBeTruthy();
});

it("bounds debounced related-question requests to ten results while title and body both contribute", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("type=question"))
        return page(
          Array.from({ length: 12 }, (_, index) =>
            post(`p${index}`, `Related ${index}`),
          ),
        );
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "A cutoff for the course",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Post body" }),
    "Deadline on Friday",
  );
  await screen.findByText("Related 0", {}, { timeout: 2000 });
  expect(screen.queryByText("Related 10")).toBeNull();
  const suggestionUrl = new URL(
    urls.filter((url) => url.includes("type=question")).at(-1)!,
    "https://example.edu",
  );
  const q = suggestionUrl.searchParams.get("q")!;
  expect(q).toContain("cutoff");
  expect(q).toContain("course");
  expect(q).toContain("friday");
  expect(q.length).toBeLessThanOrEqual(500);
  expect(suggestionUrl.searchParams.get("limit")).toBe("10");
  expect(suggestionUrl.searchParams.get("sort")).toBe("relevance");
  expect(
    screen.getByRole("link", { name: /Related 0/ }).getAttribute("target"),
  ).toBe("_blank");
});

it("does not show an obsolete feed response after the submitted query changes", async () => {
  let releaseOld!: (response: Response) => void;
  const oldPage = new Promise<Response>((resolve) => {
    releaseOld = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.includes("q=old")) return oldPage;
      return page([post("new", "New result")]);
    }),
  );
  const navigate = vi.fn();
  const view = render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="old"
      onNavigate={navigate}
    />,
  );
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="new"
      onNavigate={navigate}
    />,
  );
  await screen.findByText("New result");
  releaseOld(page([post("old", "Old result")]));
  await waitFor(() => expect(screen.queryByText("Old result")).toBeNull());
});

it("shows deleted and wrong-course details without previous identity or content", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/deleted"))
        return json({
          data: { id: "deleted", courseId: "course-1", deleted: true },
        });
      if (url.endsWith("/posts/other"))
        return json({
          data: { ...post("other", "Secret"), courseId: "other-course" },
        });
      return page([]);
    }),
  );
  const navigate = vi.fn();
  const view = render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="deleted"
      onNavigate={navigate}
    />,
  );
  await screen.findByText("This post was deleted.");
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="other"
      onNavigate={navigate}
    />,
  );
  await screen.findByText("This post is unavailable.");
  expect(screen.queryByText("Secret")).toBeNull();
  expect(screen.queryByText("Anonymous")).toBeNull();
});

it("shows an unavailable state for a hidden post returned as 404", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/hidden"))
        return json(
          { error: { code: "not_found", message: "Not found" } },
          404,
        );
      return page([]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="hidden"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("This post is unavailable.");
  expect(screen.queryByText("Anonymous")).toBeNull();
});

it("rejects blank and overlong composer fields before sending creation", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error("Unexpected create request");
    return url.endsWith("/courses/course-1")
      ? json({ data: course })
      : page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  expect(screen.getByRole("alert").textContent).toContain("Post title");
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "x".repeat(201),
  );
  await user.type(screen.getByRole("textbox", { name: "Post body" }), "body");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  expect(screen.getByRole("alert").textContent).toContain("200 characters");
  expect(
    fetchMock.mock.calls.every(([, init]) => init?.method !== "POST"),
  ).toBe(true);
});

it("keeps related questions visible after pointer exit, focus departure, and Escape", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([post("related-1", "Related cutoff question")]),
    ),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Question title",
  );
  const related = await screen.findByRole("link", {
    name: /Related cutoff question/,
  });
  const panel = screen.getByRole("heading", { name: "Related questions" })
    .parentElement!.parentElement!;
  fireEvent.mouseLeave(panel);
  expect(
    screen.getByRole("heading", { name: "Related questions" }),
  ).toBeTruthy();
  related.focus();
  fireEvent.blur(related, {
    relatedTarget: screen.getByRole("textbox", { name: "Post title" }),
  });
  expect(
    screen.getByRole("heading", { name: "Related questions" }),
  ).toBeTruthy();
  related.focus();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("heading", { name: "Related questions" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Close related questions" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Show related questions" }),
  ).toBeNull();
});

it("rejects an overlong body before sending creation", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error("Unexpected create request");
    return url.endsWith("/courses/course-1")
      ? json({ data: course })
      : page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Question title",
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Post body" }), {
    clipboardData: { getData: () => "b".repeat(100001) },
  });
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  expect(screen.getByRole("alert").textContent).toContain("100,000 characters");
  expect(
    fetchMock.mock.calls.every(([, init]) => init?.method !== "POST"),
  ).toBe(true);
});

it("ignores an older related-question response after the draft changes", async () => {
  let releaseOld!: (response: Response) => void;
  const oldPage = new Promise<Response>((resolve) => {
    releaseOld = resolve;
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/courses/course-1")) return json({ data: course });
    if (url.includes("type=question"))
      return url.includes("q=cutoff")
        ? oldPage
        : page([post("new", "New suggestion")]);
    return page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "cutoff",
  );
  await waitFor(
    () =>
      expect(
        fetchMock.mock.calls.some(([url]) => url.includes("q=cutoff")),
      ).toBe(true),
    { timeout: 2000 },
  );
  await user.clear(screen.getByRole("textbox", { name: "Post title" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "deadline",
  );
  await screen.findByText("New suggestion", {}, { timeout: 2000 });
  releaseOld(page([post("old", "Old suggestion")]));
  await waitFor(() => expect(screen.queryByText("Old suggestion")).toBeNull());
});

it("creates a note without requesting related questions", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/courses/course-1") && init?.method !== "POST")
      return json({ data: course });
    if (init?.method === "POST")
      return json(
        { data: { ...post("note-1", "Lecture note"), type: "note" } },
        201,
      );
    return page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={navigate} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.selectOptions(screen.getByLabelText("Post type"), "note");
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Lecture note",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Post body" }),
    "Summary of class",
  );
  expect(
    fetchMock.mock.calls.some(([url]) => url.includes("type=question")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/courses/course-1/posts/note-1"),
  );
  expect(
    JSON.parse(
      String(
        fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
          ?.body,
      ),
    ),
  ).toMatchObject({
    type: "note",
    title: "Lecture note",
    bodyMarkdown: "Summary of class",
  });
});

it("uses the whole long title and caps body-derived suggestion terms", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return url.endsWith("/courses/course-1")
        ? json({ data: course })
        : page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Create post" });
  await user.click(screen.getByRole("button", { name: "Create post" }));
  const title = `alpha ${"x".repeat(184)} tail`;
  fireEvent.change(screen.getByRole("textbox", { name: "Post title" }), {
    target: { value: title },
  });
  fireEvent.paste(screen.getByRole("textbox", { name: "Post body" }), {
    clipboardData: { getData: () => `bodyterm ${"z".repeat(99990)}` },
  });
  await waitFor(
    () => expect(urls.some((url) => url.includes("type=question"))).toBe(true),
    { timeout: 2000 },
  );
  const q = new URL(
    urls.find((url) => url.includes("type=question"))!,
    "https://example.edu",
  ).searchParams.get("q")!;
  expect(q).toContain("alpha");
  expect(q).toContain("tail");
  expect(q).toContain("bodyterm");
  expect(q.length).toBeLessThanOrEqual(500);
});

const now = new Date("2026-09-28T12:00:00Z");
const timeIn = (element: Element) => element.querySelector("time");

it("shows each post's creation time beside its author in the feed and detail", async () => {
  vi.setSystemTime(now);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/p2"))
        return json({
          data: {
            ...post("p2", "Older"),
            createdAt: "2026-09-10T12:00:00Z",
            updatedAt: "2026-09-27T12:00:00Z",
          },
        });
      return page([
        {
          ...post("p1", "Recent"),
          author: {
            userId: "user-maya",
            displayName: "Maya Chen",
            anonymous: false,
            deleted: false,
          },
          anonymous: false,
          createdAt: "2026-09-28T09:00:00Z",
          updatedAt: "2026-09-28T11:00:00Z",
          lastActivityAt: "2026-09-28T11:00:00Z",
        },
      ]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="p2"
      onNavigate={vi.fn()}
    />,
  );
  const listings = await screen.findByRole("region", { name: "Post listings" });
  const card = (await within(listings).findByText("Recent")).closest("a")!;
  expect(within(card).getByText("Maya Chen")).toBeTruthy();
  const cardTime = timeIn(card)!;
  expect(cardTime.textContent).toBe("3 hours ago");
  expect(cardTime.getAttribute("dateTime")).toBe("2026-09-28T09:00:00Z");
  expect(cardTime.getAttribute("title")).toContain("2026");
  expect(card.textContent).not.toMatch(/edited|updated/i);

  await screen.findByRole("heading", { name: "Older" });
  const detail = screen.getByRole("region", { name: "Post detail" });
  const detailTime = timeIn(detail)!;
  expect(detailTime.textContent).toMatch(/^Sep \d+$/);
  expect(detailTime.getAttribute("dateTime")).toBe("2026-09-10T12:00:00Z");
  expect(detailTime.getAttribute("title")).toContain("2026");
  expect(detail.textContent).not.toMatch(/edited|updated/i);
});

it("shows an anonymous post's time without identifying its author", async () => {
  vi.setSystemTime(now);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/p1"))
        return json({
          data: {
            ...post("p1", "Hidden author"),
            createdAt: now.toISOString(),
          },
        });
      return page([]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      userId="user-student"
      postId="p1"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Hidden author" });
  const byline = screen.getByText("Anonymous");
  expect(byline.textContent).toBe("Anonymous just now");
  expect(timeIn(byline)?.getAttribute("dateTime")).toBe(now.toISOString());
});

it("shows a duplicate's time in staff review detail but not on its review card", async () => {
  vi.setSystemTime(now);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      if (url.includes("duplicateStatus=confirmed"))
        return page([
          {
            id: "merged-1",
            courseId: course.id,
            type: "question",
            title: "Old question",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            canonicalTitle: "Canonical question",
            version: 2,
          },
        ]);
      if (url.endsWith("/posts/merged-1/duplicate-review"))
        return json({
          data: {
            ...post("merged-1", "Old question"),
            createdAt: "2026-09-28T10:00:00Z",
            duplicateStatus: "confirmed",
            duplicateOfPostId: "canonical-1",
            version: 2,
          },
        });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={vi.fn()}
    />,
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  await user.click(await screen.findByRole("button", { name: "Old question" }));
  const detail = screen.getByRole("region", { name: "Post detail" });
  await waitFor(() => expect(timeIn(detail)?.textContent).toBe("2 hours ago"));
  const card = screen
    .getByRole("button", { name: "Old question" })
    .closest(".post-card")!;
  expect(timeIn(card)).toBeNull();
});

it("shows no time for a deleted post or a related-question suggestion", async () => {
  vi.setSystemTime(now);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/deleted"))
        return json({
          data: {
            id: "deleted",
            courseId: "course-1",
            type: "question",
            deleted: true,
            createdAt: "2026-09-28T09:00:00Z",
            updatedAt: "2026-09-28T11:00:00Z",
            version: 2,
          },
        });
      if (url.includes("type=question"))
        return page([post("related", "Related cutoff")]);
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="deleted"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("This post was deleted.");
  const detail = screen.getByRole("region", { name: "Post detail" });
  expect(timeIn(detail)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "A cutoff question",
  );
  const suggestion = await screen.findByRole(
    "link",
    { name: /Related cutoff/ },
    { timeout: 2000 },
  );
  expect(timeIn(suggestion)).toBeNull();
});

it("makes the post detail a focusable region beside the post listings and marks only the selected row", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/p2"))
        return json({ data: post("p2", "Second") });
      return page([post("p1", "First"), post("p2", "Second")]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="p2"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Second" });
  const detail = screen.getByRole("region", { name: "Post detail" });
  expect(detail.getAttribute("tabindex")).toBe("0");
  const listings = screen.getByRole("region", { name: "Post listings" });
  expect(listings.getAttribute("tabindex")).toBe("0");
  const current = within(listings)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
  expect(current).toHaveLength(1);
  expect(current[0]!.textContent).toContain("Second");
});

it("shows answer sections under questions only", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/members/user-student"))
        return json({ data: { role: "student" } });
      if (url.endsWith("/posts/q1")) return json({ data: post("q1", "Ask") });
      if (url.endsWith("/posts/n1"))
        return json({ data: { ...post("n1", "Notice"), type: "note" } });
      if (url.endsWith("/posts/d1"))
        return json({
          data: {
            id: "d1",
            courseId: "course-1",
            type: "question",
            deleted: true,
          },
        });
      if (url.endsWith("/answers")) return json({ data: [] });
      return page([]);
    }),
  );
  const view = render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-student"
      postId="q1"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Ask" });
  expect(
    await screen.findByRole("region", { name: "Students' answer" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Instructors' answer" }),
  ).toBeTruthy();
  for (const [postId, ready] of [
    ["n1", () => screen.findByRole("heading", { name: "Notice" })],
    ["d1", () => screen.findByText("This post was deleted.")],
  ] as const) {
    view.rerender(
      <Discussion
        courseId={course.id}
        course={course}
        csrfToken="csrf"
        userId="user-student"
        postId={postId}
        onNavigate={vi.fn()}
      />,
    );
    await ready();
    expect(
      screen.queryByRole("region", { name: "Students' answer" }),
    ).toBeNull();
  }
});

function feedRequests(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([url]) => new URL(String(url), "https://example.edu"))
    .filter((url) => url.pathname === "/api/v1/courses/course-1/posts");
}

it("filters the feed from the sidebar and keeps the filter when loading more", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/courses/course-1")) return json({ data: course });
    if (url.endsWith("/members/user-me"))
      return json({ data: { role: "student" } });
    const params = new URL(url, "https://example.edu").searchParams;
    if (params.get("cursor")) return page([post("p9", "Later question")]);
    return page(
      [post(`p-${params.toString() || "all"}`, `Feed ${params}`)],
      "next",
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      userId="user-me"
      onNavigate={vi.fn()}
    />,
  );
  const sidebar = await screen.findByRole("complementary", {
    name: "Post filters",
  });
  const filter = (name: string) =>
    within(sidebar).getByRole("button", { name });
  expect(
    within(sidebar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    "All posts",
    "My posts",
    "Instructor posts",
    "TA posts",
    "Questions",
    "Answered",
    "Unanswered",
    "Pinned",
    "Notes",
    "Pinned",
  ]);
  const names = [
    "All posts",
    "My posts",
    "Instructor posts",
    "TA posts",
    "Questions",
    "Answered",
    "Unanswered",
    "Pinned questions",
    "Notes",
    "Pinned notes",
  ];
  expect(
    names.map((name) => filter(name).getAttribute("aria-pressed")),
  ).toEqual(["true", ...names.slice(1).map(() => "false")]);
  await screen.findByText("Feed");
  expect(feedRequests(fetchMock).at(-1)!.search).toBe("");

  await user.click(filter("Questions"));
  await screen.findByText("Feed type=question");
  expect(filter("Questions").getAttribute("aria-pressed")).toBe("true");
  expect(filter("All posts").getAttribute("aria-pressed")).toBe("false");
  await user.click(filter("Notes"));
  await screen.findByText("Feed type=note");
  expect(screen.queryByText("Feed type=question")).toBeNull();
  await user.click(filter("My posts"));
  await screen.findByText("Feed authorId=user-me");
  await user.click(filter("Instructor posts"));
  await screen.findByText("Feed authorRole=instructor");
  await user.click(filter("TA posts"));
  await screen.findByText("Feed authorRole=ta");
  await user.click(filter("Pinned questions"));
  await screen.findByText("Feed type=question&pinned=true");
  await user.click(filter("Pinned notes"));
  await screen.findByText("Feed type=note&pinned=true");
  expect(filter("Pinned notes").getAttribute("aria-pressed")).toBe("true");
  expect(filter("Pinned questions").getAttribute("aria-pressed")).toBe("false");
  await user.click(filter("Answered"));
  await screen.findByText("Feed answered=true");
  await user.click(filter("Unanswered"));
  await screen.findByText("Feed answered=false");
  await user.click(screen.getByRole("button", { name: "Load more posts" }));
  await screen.findByText("Later question");
  const more = feedRequests(fetchMock).at(-1)!.searchParams;
  expect(more.get("cursor")).toBe("next");
  expect(more.get("answered")).toBe("false");
  await user.click(filter("All posts"));
  await screen.findByText("Feed");
});

it("sorts the feed and offers best match only while searching", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/courses/course-1")) return json({ data: course });
    return page([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const view = render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "My posts" })).toBeNull();
  const sort = (await screen.findByRole("combobox", {
    name: "Sort by",
  })) as HTMLSelectElement;
  expect(sort.value).toBe("recent_activity");
  expect([...sort.options].map((option) => option.value)).toEqual([
    "recent_activity",
    "newest",
    "oldest",
  ]);
  await user.selectOptions(sort, "oldest");
  await waitFor(() =>
    expect(feedRequests(fetchMock).at(-1)!.searchParams.get("sort")).toBe(
      "oldest",
    ),
  );
  await user.selectOptions(sort, "newest");
  await waitFor(() =>
    expect(feedRequests(fetchMock).at(-1)!.searchParams.get("sort")).toBe(
      "newest",
    ),
  );

  await user.selectOptions(sort, "recent_activity");
  view.rerender(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      query="cutoff"
      onNavigate={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(feedRequests(fetchMock).at(-1)!.searchParams.get("q")).toBe(
      "cutoff",
    ),
  );
  await waitFor(() => expect(sort.value).toBe("relevance"));
  expect([...sort.options].map((option) => option.textContent)).toEqual([
    "Best match",
    "Last updated",
    "Newest",
    "Oldest",
  ]);
  expect(feedRequests(fetchMock).at(-1)!.searchParams.get("sort")).toBe(
    "relevance",
  );
  await user.selectOptions(sort, "newest");
  await waitFor(() => {
    const params = feedRequests(fetchMock).at(-1)!.searchParams;
    expect(params.get("q")).toBe("cutoff");
    expect(params.get("sort")).toBe("newest");
  });
});

it("disables the sidebar filters in the staff duplicate view", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/members/user-staff"))
        return json({ data: { role: "ta" } });
      return page([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      onNavigate={vi.fn()}
    />,
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Post view" }),
    "Duplicate posts",
  );
  const sidebar = screen.getByRole("complementary", { name: "Post filters" });
  expect(
    within(sidebar)
      .getByRole("button", { name: "Questions" })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    within(sidebar)
      .getByRole("combobox", { name: "Sort by" })
      .matches(":disabled"),
  ).toBe(true);
});

it("lays out each card with a type badge, status, preview, and byline from the post type list", async () => {
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      return page([
        {
          ...post("q1", "Open question"),
          answered: false,
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          ...post("q2", "Settled question"),
          answered: true,
          pinned: true,
        },
        { ...post("n1", "Office hours"), type: "note" },
        { ...post("x1", "Future kind"), type: "poll" },
      ]);
    }),
  );
  render(
    <Discussion courseId={course.id} csrfToken="csrf" onNavigate={vi.fn()} />,
  );
  const listings = await screen.findByRole("region", { name: "Post listings" });
  const card = async (title: string) =>
    within((await within(listings).findByText(title)).closest("a")!);
  const open = await card("Open question");
  expect(open.getByText("Question")).toBeTruthy();
  expect(open.getByText("Unanswered")).toBeTruthy();
  expect(open.getByText(/A useful explanation/)).toBeTruthy();
  expect(open.getByText("2 hours ago")).toBeTruthy();
  expect(open.getByText("Anonymous")).toBeTruthy();
  expect(screen.getByText("Choose a post to read it here.")).toBeTruthy();
  const settled = await card("Settled question");
  expect(settled.getByText("Answered")).toBeTruthy();
  expect(settled.getByText("Pinned")).toBeTruthy();
  const note = await card("Office hours");
  expect(note.getByText("Note")).toBeTruthy();
  expect(note.queryByText(/Answered|Unanswered/)).toBeNull();
  const unknown = await card("Future kind");
  expect(unknown.getByText("Post")).toBeTruthy();
  expect(unknown.queryByText(/Answered|Unanswered/)).toBeNull();
});

it("labels the post type in the detail pane from the post type list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/courses/course-1")) return json({ data: course });
      if (url.endsWith("/posts/n1"))
        return json({ data: { ...post("n1", "Office hours"), type: "note" } });
      return page([]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      csrfToken="csrf"
      postId="n1"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Office hours" });
  const detail = screen.getByRole("region", { name: "Post detail" });
  expect(within(detail).getByText("Note")).toBeTruthy();
});
