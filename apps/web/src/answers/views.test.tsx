import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  AnswerSections,
  FollowupSections,
  QuestionResponses,
} from "./views.js";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const props = {
  postId: "p1",
  role: "student" as const,
  courseStatus: "active" as const,
  csrfToken: "csrf",
};
const answer = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  postId: "p1",
  kind: "student",
  deleted: false,
  bodyMarkdown: "Use **ratio** and $x^2$.",
  contributors: [{ id: "u1", displayName: "Ada Lovelace" }],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 2,
  viewerUpvoted: false,
  ...overrides,
});
const followup = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  postId: "p1",
  parentId: null,
  author: { id: "u1", displayName: "Ada Lovelace" },
  anonymous: false,
  bodyMarkdown: "First followup",
  deleted: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount: 0,
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const error = (code: string, status: number) =>
  json({ error: { code, message: code } }, status);
const answers = (items: unknown[]) => json({ data: items });
const discussions = (
  items: unknown[],
  total = items.length,
  nextCursor: string | null = null,
) => json({ data: items, meta: { total, nextCursor } });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows two fixed colored slots, formatted answer content, and an upvote beneath it", async () => {
  const calls: { url: string; method?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (init?.method === "PUT")
        return json({ data: answer({ upvoteCount: 3, viewerUpvoted: true }) });
      return answers([
        answer(),
        answer({
          id: "a2",
          kind: "staff",
          bodyMarkdown: "Staff view",
          contributors: null,
        }),
      ]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const staff = screen.getByRole("region", { name: "Instructors' answer" });
  expect(await within(student).findByText("ratio")).toBeTruthy();
  expect(within(student).getByText(/Contributors: Ada Lovelace/)).toBeTruthy();
  expect(await within(staff).findByText("Staff view")).toBeTruthy();
  expect(within(staff).getByText(/Contributors: Anonymous/)).toBeTruthy();
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Upvote answer" }));
  expect(
    within(student).getByRole("button", { name: "Remove upvote from answer" })
      .textContent,
  ).toContain("3");
  expect(calls).toContainEqual({
    url: "/api/v1/answers/a1/upvote",
    method: "PUT",
  });
});

it("shows a placeholder for an existing empty answer instead of an empty body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answers([answer({ bodyMarkdown: "" })])),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(within(student).getByText("This answer is empty.")).toBeTruthy();
  expect(
    within(student).getByRole("button", { name: "Edit answer" }),
  ).toBeTruthy();
  expect(
    within(student).queryByRole("button", { name: /Start students'/ }),
  ).toBeNull();
});

it("keeps both answer areas visible through loading, failure, and retry", async () => {
  let rejectFirst!: (reason: Error) => void;
  const first = new Promise<Response>((_resolve, reject) => {
    rejectFirst = reject;
  });
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      ++requests === 1 ? first : Promise.resolve(answers([answer()])),
    ),
  );
  render(<AnswerSections {...props} />);
  const student = screen.getByRole("region", { name: "Students' answer" });
  const staff = screen.getByRole("region", { name: "Instructors' answer" });
  expect(within(student).getByText("Loading answers…")).toBeTruthy();
  expect(within(staff).getByText("Loading answers…")).toBeTruthy();
  expect(within(student).queryByRole("button", { name: /start/i })).toBeNull();
  rejectFirst(new Error("offline"));
  expect(
    await within(student).findByText(/Answers are unavailable.*offline/),
  ).toBeTruthy();
  expect(
    within(staff).getByText(/Answers are unavailable.*offline/),
  ).toBeTruthy();
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Try again" }));
  expect(await within(student).findByText("ratio")).toBeTruthy();
  expect(within(staff).getByText("No instructors' answer yet.")).toBeTruthy();
});

it("identifies the full contributors list without attributing the edit to everyone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      answers([
        answer({
          contributors: [
            { id: "u1", displayName: "Ada Lovelace" },
            { id: "u2", displayName: "Bob" },
          ],
          updatedAt: "2026-10-02T00:00:00Z",
        }),
      ]),
    ),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(
    await within(student).findByText(/Contributors: Ada Lovelace, Bob/),
  ).toBeTruthy();
  expect(within(student).queryByText(/Edited by/)).toBeNull();
  expect(student.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-10-02T00:00:00Z",
  );
});

it("shows zero followups and opens the shared Markdown/LaTeX composer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/followups") ? discussions([]) : answers([]),
    ),
  );
  render(<QuestionResponses {...props} />);
  expect(
    await screen.findByRole("region", { name: "Students' answer" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Instructors' answer" }),
  ).toBeTruthy();
  expect(await screen.findByText("0 Followup Discussions")).toBeTruthy();
  await userEvent
    .setup()
    .click(
      screen.getByRole("button", { name: "Compose a new followup discussion" }),
    );
  const followups = screen.getByRole("region", {
    name: "Followup discussions",
  });
  expect(
    within(followups).getByRole("toolbar", { name: "Followup formatting" }),
  ).toBeTruthy();
  expect(
    within(followups).getByRole("button", { name: "Inline math" }),
  ).toBeTruthy();
  expect(
    within(followups).getByRole("button", { name: "Preview" }),
  ).toBeTruthy();
});

it("starts an empty answer from a compact prompt and cancels without posting", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url.includes("/followups") ? discussions([]) : answers([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<QuestionResponses {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const staff = screen.getByRole("region", { name: "Instructors' answer" });
  await within(student).findByRole("button", {
    name: "Start students' answer",
  });
  expect(within(student).queryByRole("textbox")).toBeNull();
  expect(
    within(staff).queryByRole("button", { name: /start.*answer/i }),
  ).toBeNull();
  await userEvent
    .setup()
    .click(
      within(student).getByRole("button", { name: "Start students' answer" }),
    );
  expect(
    within(student).getByRole("textbox", { name: "Your answer" }),
  ).toBeTruthy();
  expect(
    within(student).getByRole("button", { name: "Inline math" }),
  ).toBeTruthy();
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Cancel" }));
  expect(within(student).queryByRole("textbox")).toBeNull();
  expect(
    within(student).getByRole("button", { name: "Start students' answer" }),
  ).toBeTruthy();
  expect(calls.some(({ init }) => init?.method === "POST")).toBe(false);
});

it("does not carry an answer draft into another question", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/followups") ? discussions([]) : answers([]),
    ),
  );
  const { rerender } = render(<QuestionResponses {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await within(student).findByRole("button", {
    name: "Start students' answer",
  });
  await userEvent
    .setup()
    .click(
      within(student).getByRole("button", { name: "Start students' answer" }),
    );
  await userEvent
    .setup()
    .type(
      within(student).getByRole("textbox", { name: "Your answer" }),
      "Draft for first question",
    );

  rerender(<QuestionResponses {...props} postId="p2" />);
  const nextStudent = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await within(nextStudent).findByRole("button", {
    name: "Start students' answer",
  });
  expect(within(nextStudent).queryByRole("textbox")).toBeNull();
  expect(
    within(nextStudent).queryByText("Draft for first question"),
  ).toBeNull();
  expect(
    within(nextStudent).getByRole("button", { name: "Start students' answer" }),
  ).toBeTruthy();
});

it("keeps the answer draft after a create race fills the slot", async () => {
  let raced = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        raced = true;
        return error("answer_kind_exists", 409);
      }
      return answers(
        raced ? [answer({ bodyMarkdown: "Other member's answer" })] : [],
      );
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await within(student).findByRole("button", {
    name: "Start students' answer",
  });
  await userEvent
    .setup()
    .click(
      within(student).getByRole("button", { name: "Start students' answer" }),
    );
  const editor = within(student).getByRole("textbox", { name: "Your answer" });
  await userEvent.setup().type(editor, "My draft");
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Post answer" }));
  expect(
    await within(student).findByText("Other member's answer"),
  ).toBeTruthy();
  expect(editor.textContent).toContain("My draft");
  expect(within(student).getByRole("alert").textContent).toContain(
    "answer_kind_exists",
  );
});

it("preserves a stale answer draft and displays both versions for review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return error("version_conflict", 412);
      if (url === "/api/v1/answers/a1")
        return json({
          data: answer({ bodyMarkdown: "Remote revision", version: 2 }),
        });
      return answers([answer()]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await within(student).findByRole("button", { name: "Edit answer" });
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Edit answer" }));
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await userEvent.setup().type(editor, " Local draft");
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Save answer" }));
  expect(
    await within(student).findByRole("region", { name: "Answer conflict" }),
  ).toBeTruthy();
  expect(within(student).getByText("Remote revision")).toBeTruthy();
  expect(editor.textContent).toContain("Local draft");
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Discard my draft" }));
  expect(within(student).getByText("Remote revision")).toBeTruthy();
  expect(within(student).queryByRole("textbox", { name: "Answer" })).toBeNull();
});

it("keeps two answer drafts independent until Save and renders the committed Markdown", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let saved = answer({ bodyMarkdown: "Original", version: 1 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PATCH") {
        saved = answer({
          bodyMarkdown: "Saved **bold** and $x^2$",
          version: 2,
        });
        return json({ data: saved });
      }
      if (url === "/api/v1/answers/a1") return json({ data: saved });
      return answers([saved]);
    }),
  );
  const first = render(<AnswerSections {...props} />);
  const second = render(<AnswerSections {...props} />);
  await screen.findAllByRole("button", { name: "Edit answer" });
  const user = userEvent.setup();
  await user.click(
    within(first.container).getByRole("button", { name: "Edit answer" }),
  );
  await user.click(
    within(second.container).getByRole("button", { name: "Edit answer" }),
  );
  const drafts = screen.getAllByRole("textbox", { name: "Answer" });
  await user.clear(drafts[0]);
  await user.type(drafts[0], "Saved **bold** and $x^2$");
  expect(drafts[1].textContent).toContain("Original");
  expect(calls.filter(({ init }) => init?.method === "PATCH")).toHaveLength(0);
  await user.click(
    within(first.container).getByRole("button", { name: "Save answer" }),
  );
  await waitFor(() =>
    expect(calls.filter(({ init }) => init?.method === "PATCH")).toHaveLength(
      1,
    ),
  );
  expect(
    calls.find(({ init }) => init?.method === "PATCH")?.init?.headers,
  ).toMatchObject({ "If-Match": '"v1"' });
  const rendered = first.container.querySelector("strong");
  expect(rendered?.textContent).toBe("bold");
  expect(first.container.querySelector(".katex")).toBeTruthy();
  expect(drafts[1].textContent).toContain("Original");
  second.unmount();
});

it("reviews a stale answer draft and overwrites only after an explicit choice", async () => {
  let saved = answer({ bodyMarkdown: "", version: 1 });
  const patches: { body: string; etag: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const etag = (init.headers as Record<string, string>)["If-Match"];
        const body = (JSON.parse(String(init.body)) as { bodyMarkdown: string })
          .bodyMarkdown;
        patches.push({ body, etag });
        if (etag !== `"v${saved.version}"`)
          return error("version_conflict", 412);
        saved = answer({ bodyMarkdown: body, version: saved.version + 1 });
        return json({ data: saved });
      }
      if (url === "/api/v1/answers/a1") return json({ data: saved });
      return answers([saved]);
    }),
  );
  const first = render(<AnswerSections {...props} />);
  const second = render(<AnswerSections {...props} />);
  await screen.findAllByRole("button", { name: "Edit answer" });
  const user = userEvent.setup();
  await user.click(
    within(first.container).getByRole("button", { name: "Edit answer" }),
  );
  await user.click(
    within(second.container).getByRole("button", { name: "Edit answer" }),
  );
  const firstDraft = within(first.container).getByRole("textbox", {
    name: "Answer",
  });
  const secondDraft = within(second.container).getByRole("textbox", {
    name: "Answer",
  });
  await user.type(firstDraft, "Peer **saved** text");
  await user.type(secondDraft, "My **draft** text");
  await user.click(
    within(first.container).getByRole("button", { name: "Save answer" }),
  );
  await waitFor(() => expect(saved.version).toBe(2));
  await user.click(
    within(second.container).getByRole("button", { name: "Save answer" }),
  );
  const conflict = await within(second.container).findByRole("region", {
    name: "Answer conflict",
  });
  expect(within(conflict).getByText("saved").tagName).toBe("STRONG");
  expect(within(conflict).getByText("draft").tagName).toBe("STRONG");
  expect(secondDraft.textContent).toContain("My **draft** text");
  expect(saved.bodyMarkdown).toBe("Peer **saved** text");
  expect(patches).toEqual([
    { body: "Peer **saved** text", etag: '"v1"' },
    { body: "My **draft** text", etag: '"v1"' },
  ]);
  await user.click(
    within(conflict).getByRole("button", { name: "Overwrite with my draft" }),
  );
  await waitFor(() => expect(saved.version).toBe(3));
  expect(patches[2]).toEqual({ body: "My **draft** text", etag: '"v2"' });
  expect(within(second.container).getByText("draft").tagName).toBe("STRONG");
});

it("renders a question-level followup and keeps a deleted parent visible with replies", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/answers")) return answers([]);
      if (url.endsWith("/replies"))
        return discussions([
          followup({ id: "f2", parentId: "f1", bodyMarkdown: "Child" }),
        ]);
      return discussions([
        followup({ deleted: true, bodyMarkdown: null, replyCount: 1 }),
      ]);
    }),
  );
  render(<QuestionResponses {...props} />);
  expect(await screen.findByText("This followup was deleted.")).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /replies/i }));
  expect(await screen.findByText("Child")).toBeTruthy();
});

it("shows a newly posted nested reply immediately beneath its parent", async () => {
  const child = followup({
    id: "f2",
    parentId: "f1",
    bodyMarkdown: "New **reply** and $y^2$",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/replies"))
        return json({ data: child }, 201);
      if (url.endsWith("/answers")) return answers([]);
      if (url.endsWith("/replies")) return discussions([]);
      return discussions([followup()]);
    }),
  );
  render(<QuestionResponses {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Reply" }));
  await userEvent
    .setup()
    .type(
      within(parent).getByRole("textbox", { name: "Followup" }),
      "New **reply** and $y^2$",
    );
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Post reply" }));
  expect(await within(parent).findByText("reply")).toBeTruthy();
  expect(within(parent).getByText("reply").tagName).toBe("STRONG");
  expect(parent.querySelector(".katex")).toBeTruthy();
});

it("keeps unopened older replies accessible after posting a reply", async () => {
  const oldReply = followup({
    id: "f2",
    parentId: "f1",
    bodyMarkdown: "Old reply",
  });
  const newReply = followup({
    id: "f3",
    parentId: "f1",
    bodyMarkdown: "New reply",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ data: newReply }, 201);
      if (url.endsWith("/replies")) return discussions([oldReply, newReply]);
      return discussions([followup({ replyCount: 1 })]);
    }),
  );
  render(<FollowupSections {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  const user = userEvent.setup();
  await user.click(within(parent).getByRole("button", { name: "Reply" }));
  await user.type(
    within(parent).getByRole("textbox", { name: "Followup" }),
    "New reply",
  );
  await user.click(within(parent).getByRole("button", { name: "Post reply" }));
  expect(await within(parent).findByText("New reply")).toBeTruthy();
  await user.click(
    within(parent).getByRole("button", { name: "Show 2 replies" }),
  );
  expect(await within(parent).findByText("Old reply")).toBeTruthy();
  expect(within(parent).getAllByText("New reply")).toHaveLength(1);
});

it("preserves a reply posted while older replies are loading", async () => {
  const oldReply = followup({
    id: "f2",
    parentId: "f1",
    bodyMarkdown: "Old reply",
  });
  const newReply = followup({
    id: "f3",
    parentId: "f1",
    bodyMarkdown: "New reply",
  });
  let resolveReplies!: (response: Response) => void;
  const replies = new Promise<Response>((resolve) => {
    resolveReplies = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ data: newReply }, 201);
      if (url.endsWith("/replies")) return replies;
      return discussions([followup({ replyCount: 1 })]);
    }),
  );
  render(<FollowupSections {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  const user = userEvent.setup();
  await user.click(
    within(parent).getByRole("button", { name: "Show 1 replies" }),
  );
  await user.click(within(parent).getByRole("button", { name: "Reply" }));
  await user.type(
    within(parent).getByRole("textbox", { name: "Followup" }),
    "New reply",
  );
  await user.click(within(parent).getByRole("button", { name: "Post reply" }));
  expect(await within(parent).findByText("New reply")).toBeTruthy();
  resolveReplies(discussions([oldReply]));
  expect(await within(parent).findByText("Old reply")).toBeTruthy();
  expect(within(parent).getByText("New reply")).toBeTruthy();
});

it("does not restore a deleted reply from an in-flight replies page", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const oldReply = followup({
    id: "f2",
    parentId: "f1",
    bodyMarkdown: "Old reply",
  });
  const newReply = followup({
    id: "f3",
    parentId: "f1",
    bodyMarkdown: "New reply",
  });
  let resolveReplies!: (response: Response) => void;
  const replies = new Promise<Response>((resolve) => {
    resolveReplies = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ data: newReply }, 201);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/replies")) return replies;
      return discussions([followup({ replyCount: 1 })]);
    }),
  );
  render(<FollowupSections {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  const user = userEvent.setup();
  await user.click(within(parent).getByRole("button", { name: "Reply" }));
  await user.type(
    within(parent).getByRole("textbox", { name: "Followup" }),
    "New reply",
  );
  await user.click(within(parent).getByRole("button", { name: "Post reply" }));
  const postedReply = await within(parent).findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  await user.click(
    within(parent).getByRole("button", { name: "Show 2 replies" }),
  );
  await user.click(
    within(postedReply).getByRole("button", { name: "Delete followup" }),
  );
  await waitFor(() =>
    expect(within(parent).queryByText("New reply")).toBeNull(),
  );
  resolveReplies(discussions([oldReply, newReply]));
  expect(await within(parent).findByText("Old reply")).toBeTruthy();
  expect(within(parent).queryByText("New reply")).toBeNull();
});

it("does not show a zero discussion count before loading or after failure", async () => {
  let rejectPage!: (reason: Error) => void;
  const page = new Promise<Response>((_resolve, reject) => {
    rejectPage = reject;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => page),
  );
  render(<FollowupSections {...props} />);
  expect(
    screen.getByRole("heading", { name: "Followup Discussions" }),
  ).toBeTruthy();
  rejectPage(new Error("offline"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("offline"),
  );
  expect(
    screen.getByRole("heading", { name: "Followup Discussions" }),
  ).toBeTruthy();
});

it("loads another root page and hides management actions when canEdit is false", async () => {
  const first = followup({
    id: "f1",
    bodyMarkdown: "First page",
    canEdit: false,
  });
  const second = followup({
    id: "f2",
    bodyMarkdown: "Second page",
    canEdit: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/answers")) return answers([]);
      if (url.includes("cursor=")) return discussions([second], 2);
      return discussions([first], 2, "next");
    }),
  );
  render(<QuestionResponses {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  expect(
    within(parent).getByRole("button", { name: "Upvote followup" }),
  ).toBeTruthy();
  expect(
    within(parent).queryByRole("button", { name: "Edit followup" }),
  ).toBeNull();
  expect(
    within(parent).queryByRole("button", { name: "Delete followup" }),
  ).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Load more discussions" }));
  expect(await screen.findByText("Second page")).toBeTruthy();
  expect(
    screen.getAllByRole("article", { name: "Followup by Ada Lovelace" }),
  ).toHaveLength(2);
});

it("offers staff only the staff slot and creates it with the shared editor", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return json(
          {
            data: answer({
              id: "a2",
              kind: "staff",
              bodyMarkdown: "Staff **explanation** with $x^2$",
            }),
          },
          201,
        );
      if (url.endsWith("/answers")) return answers([]);
      return discussions([]);
    }),
  );
  render(<AnswerSections {...props} role="ta" />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const staff = screen.getByRole("region", { name: "Instructors' answer" });
  await within(staff).findByRole("button", {
    name: "Start instructors' answer",
  });
  expect(within(student).queryByRole("textbox")).toBeNull();
  await userEvent
    .setup()
    .click(
      within(staff).getByRole("button", { name: "Start instructors' answer" }),
    );
  await userEvent
    .setup()
    .type(
      within(staff).getByRole("textbox", { name: "Your answer" }),
      "Staff **explanation** with $x^2$",
    );
  await userEvent
    .setup()
    .click(within(staff).getByRole("button", { name: "Post answer" }));
  expect(await within(staff).findByText("explanation")).toBeTruthy();
  expect(within(staff).getByText("explanation").tagName).toBe("STRONG");
  expect(staff.querySelector(".katex")).toBeTruthy();
  expect(within(staff).queryByText(/\*\*explanation\*\*/)).toBeNull();
});

it("edits and deletes an owned followup with the projected controls", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH")
        return json({
          data: followup({ bodyMarkdown: "Updated **followup**", version: 2 }),
        });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/answers")) return answers([]);
      return discussions([followup()]);
    }),
  );
  render(<QuestionResponses {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Edit followup" }));
  expect(
    within(parent).queryByRole("region", { name: /Live followup editor/ }),
  ).toBeNull();
  const editor = within(parent).getByRole("textbox", { name: "Followup" });
  await userEvent.setup().click(editor);
  await userEvent.setup().keyboard("{Control>}a{/Control}Updated **followup**");
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Save followup" }));
  expect(await within(parent).findByText("followup")).toBeTruthy();
  expect(within(parent).getByText("followup").tagName).toBe("STRONG");
  expect(within(parent).queryByText(/\*\*followup\*\*/)).toBeNull();
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Delete followup" }));
  expect(
    screen.queryByRole("article", { name: "Followup by Ada Lovelace" }),
  ).toBeNull();
});

it("renders a saved answer correction as bold Markdown and LaTeX", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH")
        return json({
          data: answer({
            bodyMarkdown: "Corrected **answer** and $x^2$",
            version: 2,
          }),
        });
      return answers([answer()]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Edit answer" }));
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await userEvent.setup().click(editor);
  await userEvent
    .setup()
    .keyboard("{Control>}a{/Control}Corrected **answer** and $x^2$");
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Save answer" }));
  expect(await within(student).findByText("answer")).toBeTruthy();
  expect(within(student).getByText("answer").tagName).toBe("STRONG");
  expect(student.querySelector(".katex")).toBeTruthy();
});

it("locks an answer draft while Save is pending", async () => {
  let resolveSave!: (response: Response) => void;
  const save = new Promise<Response>((resolve) => {
    resolveSave = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? save : answers([answer()]),
    ),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    await within(student).findByRole("button", { name: "Edit answer" }),
  );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await user.type(editor, " saved");
  const submitted = editor.textContent;
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  expect(editor.getAttribute("contenteditable")).toBe("false");
  await user.type(editor, " later");
  expect(editor.textContent).toBe(submitted);
  resolveSave(json({ data: answer({ bodyMarkdown: submitted, version: 2 }) }));
  expect(await within(student).findByText(/saved/)).toBeTruthy();
});

it("locks shared composers during submit and allows editing again after failure", async () => {
  let rejectCreate!: (reason: Error) => void;
  const create = new Promise<Response>((_resolve, reject) => {
    rejectCreate = reject;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? create : discussions([]),
    ),
  );
  render(<FollowupSections {...props} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Compose a new followup discussion",
    }),
  );
  const editor = screen.getByRole("textbox", { name: "Followup" });
  await user.type(editor, "Initial draft");
  await user.click(screen.getByRole("button", { name: "Post followup" }));
  expect(editor.getAttribute("contenteditable")).toBe("false");
  await user.type(editor, " later");
  expect(editor.textContent).toBe("Initial draft");
  rejectCreate(new Error("offline"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "offline",
  );
  await waitFor(() =>
    expect(editor.getAttribute("contenteditable")).toBe("true"),
  );
  await user.type(editor, " later");
  expect(editor.textContent).toContain("Initial draft");
  expect(editor.textContent).toContain("later");
});

it("does not let a late vote response roll back a saved answer", async () => {
  let resolveVote!: (response: Response) => void;
  const vote = new Promise<Response>((resolve) => {
    resolveVote = resolve;
  });
  const etags: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return vote;
      if (init?.method === "PATCH") {
        etags.push((init.headers as Record<string, string>)["If-Match"]);
        const bodyMarkdown = (
          JSON.parse(String(init.body)) as { bodyMarkdown: string }
        ).bodyMarkdown;
        return json({
          data: answer({ bodyMarkdown, version: etags.length + 1 }),
        });
      }
      return answers([answer({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    await within(student).findByRole("button", { name: "Upvote answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Edit answer" }),
  );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}Saved version");
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  expect(await within(student).findByText("Saved version")).toBeTruthy();
  resolveVote(
    json({
      data: answer({
        bodyMarkdown: "Original",
        upvoteCount: 3,
        viewerUpvoted: true,
      }),
    }),
  );
  await waitFor(() =>
    expect(
      within(student)
        .getByRole("button", { name: "Remove upvote from answer" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(within(student).getByText("Saved version")).toBeTruthy();
  await user.click(
    within(student).getByRole("button", { name: "Edit answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  await waitFor(() => expect(etags).toEqual(['"v1"', '"v2"']));
});

it("keeps newer followup text when vote and reply responses arrive late", async () => {
  let resolveVote!: (response: Response) => void;
  let resolveReply!: (response: Response) => void;
  const vote = new Promise<Response>((resolve) => {
    resolveVote = resolve;
  });
  const reply = new Promise<Response>((resolve) => {
    resolveReply = resolve;
  });
  let version = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return vote;
      if (init?.method === "POST") return reply;
      if (init?.method === "PATCH") {
        version++;
        const bodyMarkdown = (
          JSON.parse(String(init.body)) as { bodyMarkdown: string }
        ).bodyMarkdown;
        return json({ data: followup({ bodyMarkdown, version }) });
      }
      if (url.endsWith("/answers")) return answers([]);
      return discussions([followup({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<FollowupSections {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  const user = userEvent.setup();
  await user.click(
    within(parent).getByRole("button", { name: "Upvote followup" }),
  );
  await user.click(within(parent).getByRole("button", { name: "Reply" }));
  await user.type(
    within(parent).getByRole("textbox", { name: "Followup" }),
    "New reply",
  );
  await user.click(within(parent).getByRole("button", { name: "Post reply" }));
  await user.click(
    within(parent).getByRole("button", { name: "Edit followup" }),
  );
  const editor = within(parent).getAllByRole("textbox", {
    name: "Followup",
  })[0];
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}Saved revision");
  await user.click(
    within(parent).getByRole("button", { name: "Save followup" }),
  );
  expect(await within(parent).findByText("Saved revision")).toBeTruthy();
  resolveVote(
    json({
      data: followup({
        bodyMarkdown: "Original",
        upvoteCount: 1,
        viewerUpvoted: true,
      }),
    }),
  );
  resolveReply(
    json(
      {
        data: followup({ id: "f2", parentId: "f1", bodyMarkdown: "New reply" }),
      },
      201,
    ),
  );
  expect(await within(parent).findByText("New reply")).toBeTruthy();
  expect(within(parent).getByText("Saved revision")).toBeTruthy();
  expect(
    within(parent).getByRole("button", { name: "Show 1 replies" }),
  ).toBeTruthy();
});

it.each(["root", "nested"] as const)(
  "keeps a %s followup's new reply count after a late vote response",
  async (level) => {
    let resolveVote!: (response: Response) => void;
    const vote = new Promise<Response>((resolve) => {
      resolveVote = resolve;
    });
    const nested = followup({
      id: "f2",
      parentId: "f1",
      bodyMarkdown: "Nested parent",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return vote;
        if (init?.method === "POST")
          return json(
            {
              data: followup({
                id: "f3",
                parentId: level === "root" ? "f1" : "f2",
                bodyMarkdown: "New reply",
              }),
            },
            201,
          );
        if (url.endsWith("/f1/replies")) return discussions([nested]);
        return discussions([
          followup({
            bodyMarkdown: "Root parent",
            replyCount: level === "nested" ? 1 : 0,
          }),
        ]);
      }),
    );
    render(<FollowupSections {...props} />);
    const root = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    const user = userEvent.setup();
    if (level === "nested")
      await user.click(
        within(root).getByRole("button", { name: "Show 1 replies" }),
      );
    const target =
      level === "root"
        ? root
        : (await within(root).findByText("Nested parent")).closest("article")!;
    await user.click(
      within(target).getByRole("button", { name: "Upvote followup" }),
    );
    await user.click(
      within(target).getAllByRole("button", { name: "Reply" })[0],
    );
    await user.type(
      within(target).getByRole("textbox", { name: "Followup" }),
      "New reply",
    );
    await user.click(
      within(target).getByRole("button", { name: "Post reply" }),
    );
    expect(await within(target).findByText("New reply")).toBeTruthy();
    expect(
      within(target).getByRole("button", { name: "Show 1 replies" }),
    ).toBeTruthy();
    resolveVote(
      json({
        data: followup({
          id: level === "root" ? "f1" : "f2",
          parentId: level === "root" ? null : "f1",
          bodyMarkdown: level === "root" ? "Root parent" : "Nested parent",
          replyCount: 0,
          upvoteCount: 1,
          viewerUpvoted: true,
        }),
      }),
    );
    await waitFor(() =>
      expect(
        within(target).getByRole("button", {
          name: "Remove upvote from followup",
        }),
      ).toBeTruthy(),
    );
    expect(
      within(target).getByRole("button", { name: "Show 1 replies" }),
    ).toBeTruthy();
    expect(within(target).getByText("New reply")).toBeTruthy();
  },
);

it("does not retry an unrelated authoritative GET failure", async () => {
  let resolveSave!: (response: Response) => void;
  const save = new Promise<Response>((resolve) => {
    resolveSave = resolve;
  });
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return save;
      if (init?.method === "PUT")
        return json({ data: answer({ upvoteCount: 3, viewerUpvoted: true }) });
      if (url === "/api/v1/answers/a1") {
        gets++;
        throw new Error("offline");
      }
      return answers([answer({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    within(student).getByRole("button", { name: "Edit answer" }),
  );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}Saved revision");
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Upvote answer" }),
  );
  await within(student).findByRole("button", {
    name: "Remove upvote from answer",
  });
  resolveSave(
    json({ data: answer({ bodyMarkdown: "Saved revision", version: 2 }) }),
  );
  expect(await within(student).findByRole("alert")).toHaveProperty(
    "textContent",
    "offline",
  );
  expect(gets).toBe(1);
  expect(within(student).getByText("Saved revision")).toBeTruthy();
});

it.each([3, 4])(
  "uses an authoritative answer vote count of %i after an overlapping Save",
  async (serverCount) => {
    let resolveSave!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return save;
        if (init?.method === "PUT")
          return json({
            data: answer({ upvoteCount: 3, viewerUpvoted: true }),
          });
        if (url === "/api/v1/answers/a1")
          return json({
            data: answer({
              bodyMarkdown: "Saved revision",
              version: 2,
              upvoteCount: serverCount,
              viewerUpvoted: true,
            }),
          });
        return answers([answer({ bodyMarkdown: "Original" })]);
      }),
    );
    render(<AnswerSections {...props} />);
    const student = await screen.findByRole("region", {
      name: "Students' answer",
    });
    const user = userEvent.setup();
    await user.click(
      await within(student).findByRole("button", { name: "Edit answer" }),
    );
    const editor = within(student).getByRole("textbox", { name: "Answer" });
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}Saved revision");
    await user.click(
      within(student).getByRole("button", { name: "Save answer" }),
    );
    await user.click(
      within(student).getByRole("button", { name: "Upvote answer" }),
    );
    expect(
      (
        await within(student).findByRole("button", {
          name: "Remove upvote from answer",
        })
      ).textContent,
    ).toContain("3");
    resolveSave(
      json({ data: answer({ bodyMarkdown: "Saved revision", version: 2 }) }),
    );
    expect(await within(student).findByText("Saved revision")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(student).getByRole("button", {
          name: "Remove upvote from answer",
        }).textContent,
      ).toContain(String(serverCount)),
    );
  },
);

it.each([
  ["root", 1],
  ["nested", 1],
  ["root", 2],
  ["nested", 2],
] as const)(
  "uses authoritative %s followup activity count %i after Save",
  async (level, serverCount) => {
    let resolveSave!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    const targetId = level === "root" ? "f1" : "f2";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return save;
        if (init?.method === "PUT")
          return json({
            data: followup({
              id: targetId,
              upvoteCount: 1,
              viewerUpvoted: true,
            }),
          });
        if (init?.method === "POST")
          return json(
            {
              data: followup({
                id: "f3",
                parentId: targetId,
                bodyMarkdown: "New reply",
              }),
            },
            201,
          );
        if (url === `/api/v1/followups/${targetId}`)
          return json({
            data: followup({
              id: targetId,
              parentId: level === "root" ? null : "f1",
              bodyMarkdown: "Saved revision",
              version: 2,
              upvoteCount: serverCount,
              viewerUpvoted: true,
              replyCount: serverCount,
            }),
          });
        if (url.endsWith("/f1/replies"))
          return discussions([
            followup({
              id: "f2",
              parentId: "f1",
              bodyMarkdown: "Nested parent",
            }),
          ]);
        return discussions([
          followup({
            bodyMarkdown: "Root parent",
            replyCount: level === "nested" ? 1 : 0,
          }),
        ]);
      }),
    );
    render(<FollowupSections {...props} />);
    const root = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    const user = userEvent.setup();
    if (level === "nested")
      await user.click(
        within(root).getByRole("button", { name: "Show 1 replies" }),
      );
    const target =
      level === "root"
        ? root
        : (await within(root).findByText("Nested parent")).closest("article")!;
    await user.click(
      within(target).getByRole("button", { name: "Edit followup" }),
    );
    const editor = within(target).getByRole("textbox", { name: "Followup" });
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}Saved revision");
    await user.click(
      within(target).getByRole("button", { name: "Save followup" }),
    );
    await user.click(
      within(target).getByRole("button", { name: "Upvote followup" }),
    );
    await within(target).findByRole("button", {
      name: "Remove upvote from followup",
    });
    await user.click(within(target).getByRole("button", { name: "Reply" }));
    await user.type(
      within(target).getAllByRole("textbox", { name: "Followup" })[1],
      "New reply",
    );
    await user.click(
      within(target).getByRole("button", { name: "Post reply" }),
    );
    await within(target).findByText("New reply");
    resolveSave(
      json({
        data: followup({
          id: targetId,
          parentId: level === "root" ? null : "f1",
          bodyMarkdown: "Saved revision",
          version: 2,
          upvoteCount: 0,
          viewerUpvoted: false,
          replyCount: 0,
        }),
      }),
    );
    expect(await within(target).findByText("Saved revision")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(target).getByRole("button", {
          name: "Remove upvote from followup",
        }).textContent,
      ).toContain(String(serverCount)),
    );
    expect(
      within(target).getByRole("button", {
        name: `Show ${serverCount} replies`,
      }),
    ).toBeTruthy();
  },
);

it("preserves followup activity after a late conflict refresh", async () => {
  let resolveRefresh!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  let refreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return error("version_conflict", 412);
      if (url === "/api/v1/followups/f1" && !init?.method)
        return ++refreshes === 1
          ? refresh
          : json({
              data: followup({
                bodyMarkdown: "Remote revision",
                version: 2,
                upvoteCount: 2,
                viewerUpvoted: true,
                replyCount: 2,
              }),
            });
      if (init?.method === "PUT")
        return json({
          data: followup({ upvoteCount: 1, viewerUpvoted: true }),
        });
      if (init?.method === "POST")
        return json(
          {
            data: followup({
              id: "f2",
              parentId: "f1",
              bodyMarkdown: "New reply",
            }),
          },
          201,
        );
      return discussions([followup({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<FollowupSections {...props} />);
  const parent = await screen.findByRole("article", {
    name: "Followup by Ada Lovelace",
  });
  const user = userEvent.setup();
  await user.click(
    within(parent).getByRole("button", { name: "Edit followup" }),
  );
  await user.click(
    within(parent).getByRole("button", { name: "Save followup" }),
  );
  await user.click(
    await within(parent).findByRole("button", { name: "Refresh content" }),
  );
  await user.click(
    within(parent).getByRole("button", { name: "Upvote followup" }),
  );
  await within(parent).findByRole("button", {
    name: "Remove upvote from followup",
  });
  await user.click(within(parent).getByRole("button", { name: "Reply" }));
  await user.type(
    within(parent).getAllByRole("textbox", { name: "Followup" })[1],
    "New reply",
  );
  await user.click(within(parent).getByRole("button", { name: "Post reply" }));
  await within(parent).findByText("New reply");
  resolveRefresh(
    json({ data: followup({ bodyMarkdown: "Remote revision", version: 2 }) }),
  );
  await within(parent).findByText(/Latest version loaded/);
  await user.click(within(parent).getByRole("button", { name: "Cancel" }));
  expect(within(parent).getByText("Remote revision")).toBeTruthy();
  await waitFor(() =>
    expect(
      within(parent).getByRole("button", {
        name: "Remove upvote from followup",
      }).textContent,
    ).toContain("2"),
  );
  expect(
    within(parent).getByRole("button", { name: "Show 2 replies" }),
  ).toBeTruthy();
});

it("preserves an answer vote when discarding after a late conflict refresh", async () => {
  let resolveRefresh!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  let refreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return error("version_conflict", 412);
      if (url === "/api/v1/answers/a1" && !init?.method)
        return ++refreshes === 1
          ? refresh
          : json({
              data: answer({
                bodyMarkdown: "Remote revision",
                version: 2,
                upvoteCount: 4,
                viewerUpvoted: true,
              }),
            });
      if (init?.method === "PUT")
        return json({
          data: answer({
            bodyMarkdown: "Original",
            upvoteCount: 3,
            viewerUpvoted: true,
          }),
        });
      return answers([answer({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    await within(student).findByRole("button", { name: "Edit answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Upvote answer" }),
  );
  await within(student).findByRole("button", {
    name: "Remove upvote from answer",
  });
  resolveRefresh(
    json({ data: answer({ bodyMarkdown: "Remote revision", version: 2 }) }),
  );
  await user.click(
    await within(student).findByRole("button", { name: "Discard my draft" }),
  );
  expect(within(student).getByText("Remote revision")).toBeTruthy();
  await waitFor(() =>
    expect(
      within(student).getByRole("button", { name: "Remove upvote from answer" })
        .textContent,
    ).toContain("4"),
  );
});

it.each([
  ["root", "get-first"],
  ["root", "reply-first"],
  ["nested", "get-first"],
  ["nested", "reply-first"],
] as const)(
  "refreshes %s followup activity after a reply settles %s",
  async (level, order) => {
    let resolveSave!: (response: Response) => void;
    let resolveGet!: (response: Response) => void;
    let resolveReply!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    const firstGet = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    const secondReply = new Promise<Response>((resolve) => {
      resolveReply = resolve;
    });
    const targetId = level === "root" ? "f1" : "f2";
    let gets = 0;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return save;
        if (init?.method === "POST") {
          posts++;
          return posts === 1
            ? json(
                {
                  data: followup({
                    id: "f3",
                    parentId: targetId,
                    bodyMarkdown: "First reply",
                  }),
                },
                201,
              )
            : secondReply;
        }
        if (url === `/api/v1/followups/${targetId}`) {
          gets++;
          return gets === 1
            ? firstGet
            : json({
                data: followup({
                  id: targetId,
                  parentId: level === "root" ? null : "f1",
                  bodyMarkdown: "Saved revision",
                  version: 2,
                  replyCount: 3,
                }),
              });
        }
        if (url.endsWith("/f1/replies"))
          return discussions([
            followup({
              id: "f2",
              parentId: "f1",
              bodyMarkdown: "Nested parent",
            }),
          ]);
        return discussions([
          followup({
            bodyMarkdown: "Root parent",
            replyCount: level === "nested" ? 1 : 0,
          }),
        ]);
      }),
    );
    render(<FollowupSections {...props} />);
    const root = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    const user = userEvent.setup();
    if (level === "nested")
      await user.click(
        within(root).getByRole("button", { name: "Show 1 replies" }),
      );
    const target =
      level === "root"
        ? root
        : (await within(root).findByText("Nested parent")).closest("article")!;
    await user.click(
      within(target).getByRole("button", { name: "Edit followup" }),
    );
    const editor = within(target).getByRole("textbox", { name: "Followup" });
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}Saved revision");
    await user.click(
      within(target).getByRole("button", { name: "Save followup" }),
    );
    await user.click(within(target).getByRole("button", { name: "Reply" }));
    await user.type(
      within(target).getAllByRole("textbox", { name: "Followup" })[1],
      "First reply",
    );
    await user.click(
      within(target).getByRole("button", { name: "Post reply" }),
    );
    await within(target).findByText("First reply");
    resolveSave(
      json({
        data: followup({
          id: targetId,
          parentId: level === "root" ? null : "f1",
          bodyMarkdown: "Saved revision",
          version: 2,
        }),
      }),
    );
    await waitFor(() => expect(gets).toBe(1));
    await user.click(
      within(target).getAllByRole("button", { name: "Reply" })[0],
    );
    await user.type(
      within(target).getAllByRole("textbox", { name: "Followup" }).at(-1)!,
      "Second reply",
    );
    await user.click(
      within(target).getByRole("button", { name: "Post reply" }),
    );
    const fresh = json({
      data: followup({
        id: targetId,
        parentId: level === "root" ? null : "f1",
        bodyMarkdown: "Saved revision",
        version: 2,
        replyCount: 3,
      }),
    });
    const local = json(
      {
        data: followup({
          id: "f4",
          parentId: targetId,
          bodyMarkdown: "Second reply",
        }),
      },
      201,
    );
    if (order === "get-first") {
      resolveGet(fresh);
      resolveReply(local);
    } else {
      resolveReply(local);
      await within(target).findByText("Second reply");
      resolveGet(fresh);
    }
    await waitFor(() => expect(gets).toBe(2));
    expect(await within(target).findByText("Saved revision")).toBeTruthy();
    expect(
      await within(target).findByRole("button", { name: "Show 3 replies" }),
    ).toBeTruthy();
  },
);

it("re-reads answer votes settled during an authoritative GET", async () => {
  let resolveSave!: (response: Response) => void;
  let resolveGet!: (response: Response) => void;
  const save = new Promise<Response>((resolve) => {
    resolveSave = resolve;
  });
  const firstGet = new Promise<Response>((resolve) => {
    resolveGet = resolve;
  });
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return save;
      if (init?.method === "PUT")
        return json({ data: answer({ upvoteCount: 3, viewerUpvoted: true }) });
      if (init?.method === "DELETE")
        return json({ data: answer({ upvoteCount: 2, viewerUpvoted: false }) });
      if (url === "/api/v1/answers/a1") {
        gets++;
        return gets === 1
          ? firstGet
          : json({
              data: answer({
                bodyMarkdown: "Saved revision",
                version: 2,
                upvoteCount: 5,
                viewerUpvoted: false,
              }),
            });
      }
      return answers([answer({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    await within(student).findByRole("button", { name: "Edit answer" }),
  );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}Saved revision");
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Upvote answer" }),
  );
  await within(student).findByRole("button", {
    name: "Remove upvote from answer",
  });
  resolveSave(
    json({ data: answer({ bodyMarkdown: "Saved revision", version: 2 }) }),
  );
  await waitFor(() => expect(gets).toBe(1));
  await user.click(
    within(student).getByRole("button", { name: "Remove upvote from answer" }),
  );
  await within(student).findByRole("button", { name: "Upvote answer" });
  resolveGet(
    json({
      data: answer({
        bodyMarkdown: "Saved revision",
        version: 2,
        upvoteCount: 5,
        viewerUpvoted: false,
      }),
    }),
  );
  await waitFor(() => expect(gets).toBe(2));
  await waitFor(() =>
    expect(
      within(student).getByRole("button", { name: "Upvote answer" })
        .textContent,
    ).toContain("5"),
  );
});

it("re-reads an answer after an overlapping authoritative GET fails", async () => {
  let resolveSave!: (response: Response) => void;
  let rejectGet!: (reason: Error) => void;
  const save = new Promise<Response>((resolve) => {
    resolveSave = resolve;
  });
  const firstGet = new Promise<Response>((_resolve, reject) => {
    rejectGet = reject;
  });
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return save;
      if (init?.method === "PUT")
        return json({ data: answer({ upvoteCount: 3, viewerUpvoted: true }) });
      if (init?.method === "DELETE")
        return json({ data: answer({ upvoteCount: 2, viewerUpvoted: false }) });
      if (url === "/api/v1/answers/a1") {
        gets++;
        return gets === 1
          ? firstGet
          : json({
              data: answer({
                bodyMarkdown: "Saved revision",
                version: 2,
                upvoteCount: 5,
                viewerUpvoted: false,
              }),
            });
      }
      return answers([answer({ bodyMarkdown: "Original" })]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  const user = userEvent.setup();
  await user.click(
    within(student).getByRole("button", { name: "Edit answer" }),
  );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}Saved revision");
  await user.click(
    within(student).getByRole("button", { name: "Save answer" }),
  );
  await user.click(
    within(student).getByRole("button", { name: "Upvote answer" }),
  );
  await within(student).findByRole("button", {
    name: "Remove upvote from answer",
  });
  resolveSave(
    json({ data: answer({ bodyMarkdown: "Saved revision", version: 2 }) }),
  );
  await waitFor(() => expect(gets).toBe(1));
  await user.click(
    within(student).getByRole("button", { name: "Remove upvote from answer" }),
  );
  await within(student).findByRole("button", { name: "Upvote answer" });
  rejectGet(new Error("offline"));
  await waitFor(() => expect(gets).toBe(2));
  await waitFor(() =>
    expect(
      within(student).getByRole("button", { name: "Upvote answer" })
        .textContent,
    ).toContain("5"),
  );
  expect(within(student).getByText("Saved revision")).toBeTruthy();
});

it.each(["root", "nested"] as const)(
  "re-reads a %s followup after an overlapping authoritative GET fails",
  async (level) => {
    let resolveSave!: (response: Response) => void;
    let rejectGet!: (reason: Error) => void;
    const save = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    const firstGet = new Promise<Response>((_resolve, reject) => {
      rejectGet = reject;
    });
    const targetId = level === "root" ? "f1" : "f2";
    let gets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return save;
        if (init?.method === "PUT")
          return json({
            data: followup({
              id: targetId,
              upvoteCount: 1,
              viewerUpvoted: true,
            }),
          });
        if (init?.method === "DELETE")
          return json({
            data: followup({
              id: targetId,
              upvoteCount: 0,
              viewerUpvoted: false,
            }),
          });
        if (url === `/api/v1/followups/${targetId}`) {
          gets++;
          return gets === 1
            ? firstGet
            : json({
                data: followup({
                  id: targetId,
                  parentId: level === "root" ? null : "f1",
                  bodyMarkdown: "Saved revision",
                  version: 2,
                  upvoteCount: 4,
                  viewerUpvoted: false,
                }),
              });
        }
        if (url.endsWith("/f1/replies"))
          return discussions([
            followup({
              id: "f2",
              parentId: "f1",
              bodyMarkdown: "Nested parent",
            }),
          ]);
        return discussions([
          followup({
            bodyMarkdown: "Root parent",
            replyCount: level === "nested" ? 1 : 0,
          }),
        ]);
      }),
    );
    render(<FollowupSections {...props} />);
    const root = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    const user = userEvent.setup();
    if (level === "nested")
      await user.click(
        within(root).getByRole("button", { name: "Show 1 replies" }),
      );
    const target =
      level === "root"
        ? root
        : (await within(root).findByText("Nested parent")).closest("article")!;
    await user.click(
      within(target).getByRole("button", { name: "Edit followup" }),
    );
    const editor = within(target).getByRole("textbox", { name: "Followup" });
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}Saved revision");
    await user.click(
      within(target).getByRole("button", { name: "Save followup" }),
    );
    await user.click(
      within(target).getByRole("button", { name: "Upvote followup" }),
    );
    await within(target).findByRole("button", {
      name: "Remove upvote from followup",
    });
    resolveSave(
      json({
        data: followup({
          id: targetId,
          parentId: level === "root" ? null : "f1",
          bodyMarkdown: "Saved revision",
          version: 2,
        }),
      }),
    );
    await waitFor(() => expect(gets).toBe(1));
    await user.click(
      within(target).getByRole("button", {
        name: "Remove upvote from followup",
      }),
    );
    await within(target).findByRole("button", { name: "Upvote followup" });
    rejectGet(new Error("offline"));
    await waitFor(() => expect(gets).toBe(2));
    await waitFor(() =>
      expect(
        within(target).getByRole("button", { name: "Upvote followup" })
          .textContent,
      ).toContain("4"),
    );
    expect(within(target).getByText("Saved revision")).toBeTruthy();
  },
);

it("shows an answer image and a followup document beneath their text", async () => {
  const image = {
    id: "image-1",
    fileName: "diagram.png",
    mediaType: "image/png",
    sizeBytes: 3,
    createdAt: "2026-10-18T00:00:00Z",
    downloadUrl: "/api/v1/attachments/image-1/download",
  };
  const document = {
    ...image,
    id: "doc-1",
    fileName: "slides.pptx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    downloadUrl: "/api/v1/attachments/doc-1/download",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/answers")
        ? answers([answer({ attachments: [image] })])
        : discussions([followup({ attachments: [document] })]),
    ),
  );
  render(<QuestionResponses {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(
    (
      await within(student).findByRole("img", { name: "diagram.png" })
    ).getAttribute("src"),
  ).toBe(image.downloadUrl);
  expect(
    (await screen.findByRole("link", { name: "slides.pptx" })).getAttribute(
      "href",
    ),
  ).toBe(document.downloadUrl);
});

it.each([
  ["student", "Students' answer", "student"],
  ["staff", "Instructors' answer", "ta"],
] as const)(
  "shows %s answer file controls only after Edit",
  async (kind, slot, role) => {
    const document = {
      id: "doc-1",
      fileName: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      createdAt: "2026-10-18T00:00:00Z",
      downloadUrl: "/api/v1/attachments/doc-1/download",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/answers")
          ? answers([answer({ kind, attachments: [document] })])
          : discussions([]),
      ),
    );
    render(<AnswerSections {...props} role={role} />);
    const card = within(
      await screen.findByRole("region", { name: slot }),
    ).getByRole("region", { name: /Answer by/ });
    expect(within(card).getByRole("link", { name: "notes.txt" })).toBeTruthy();
    expect(within(card).queryByLabelText("Add files")).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "Remove notes.txt" }),
    ).toBeNull();
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: "Edit answer" }));
    expect(within(card).getByLabelText("Add files")).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Remove notes.txt" }),
    ).toBeTruthy();
  },
);

it.each(["root", "reply"] as const)(
  "shows %s followup file controls only after Edit",
  async (level) => {
    const document = {
      id: "doc-1",
      fileName: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      createdAt: "2026-10-18T00:00:00Z",
      downloadUrl: "/api/v1/attachments/doc-1/download",
    };
    const root = followup({ replyCount: 1, attachments: [document] });
    const child = followup({
      id: "f2",
      parentId: "f1",
      attachments: [document],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/replies") ? discussions([child]) : discussions([root]),
      ),
    );
    render(<FollowupSections {...props} />);
    const parent = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    if (level === "reply")
      await userEvent
        .setup()
        .click(within(parent).getByRole("button", { name: "Show 1 replies" }));
    const card =
      level === "root"
        ? parent
        : within(parent).getAllByRole("article", {
            name: "Followup by Ada Lovelace",
          })[0];
    expect(within(card).getByRole("link", { name: "notes.txt" })).toBeTruthy();
    expect(within(card).queryByLabelText("Add files")).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "Remove notes.txt" }),
    ).toBeNull();
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: "Edit followup" }));
    expect(within(card).getByLabelText("Add files")).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Remove notes.txt" }),
    ).toBeTruthy();
  },
);

it.each([
  ["archived", true],
  ["active", false],
] as const)(
  "keeps %s response attachments read-only when edit is unavailable",
  async (status, editable) => {
    const document = {
      id: "doc-1",
      fileName: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      createdAt: "2026-10-18T00:00:00Z",
      downloadUrl: "/api/v1/attachments/doc-1/download",
    };
    const root = followup({
      replyCount: 1,
      attachments: [document],
      canEdit: editable,
    });
    const child = followup({
      id: "f2",
      parentId: "f1",
      attachments: [document],
      canEdit: editable,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/answers"))
          return answers([
            answer({ attachments: [document], canEdit: editable }),
          ]);
        if (url.endsWith("/replies")) return discussions([child]);
        return discussions([root]);
      }),
    );
    render(<QuestionResponses {...props} courseStatus={status} />);
    const answerCard = within(
      await screen.findByRole("region", { name: "Students' answer" }),
    ).getByRole("region", { name: /Answer by/ });
    const rootCard = await screen.findByRole("article", {
      name: "Followup by Ada Lovelace",
    });
    await userEvent
      .setup()
      .click(within(rootCard).getByRole("button", { name: "Show 1 replies" }));
    const replyCard = within(rootCard).getAllByRole("article", {
      name: "Followup by Ada Lovelace",
    })[0];
    for (const card of [answerCard, rootCard, replyCard]) {
      expect(
        within(card).getAllByRole("link", { name: "notes.txt" }).length,
      ).toBeGreaterThan(0);
      expect(within(card).queryByLabelText("Add files")).toBeNull();
      expect(
        within(card).queryByRole("button", { name: "Remove notes.txt" }),
      ).toBeNull();
    }
    expect(
      within(answerCard).queryByRole("button", { name: "Edit answer" }),
    ).toBeNull();
    expect(
      within(replyCard).queryByRole("button", { name: "Edit followup" }),
    ).toBeNull();
  },
);

it("keeps a shared answer after an attachment failure and retries without creating another answer", async () => {
  let creates = 0;
  let uploads = 0;
  const picture = {
    id: "attachment-1",
    fileName: "proof.png",
    mediaType: "image/png",
    sizeBytes: 3,
    createdAt: "2026-10-18T00:00:00Z",
    downloadUrl: "/api/v1/attachments/attachment-1/download",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/posts/p1/answers" && init?.method === "POST") {
        creates++;
        return json({ data: answer() }, 201);
      }
      if (url === "/api/v1/answers/a1/attachments" && init?.method === "POST") {
        uploads++;
        return uploads === 1
          ? error("storage_unavailable", 503)
          : json({ data: picture }, 201);
      }
      if (url === "/api/v1/answers/a1")
        return json({ data: answer({ attachments: [picture], version: 2 }) });
      return answers([]);
    }),
  );
  render(<AnswerSections {...props} />);
  const student = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await userEvent.setup().click(
    await within(student).findByRole("button", {
      name: "Start students' answer",
    }),
  );
  await userEvent
    .setup()
    .type(
      within(student).getByRole("textbox", { name: "Your answer" }),
      "Explanation",
    );
  await userEvent
    .setup()
    .upload(
      within(student).getByLabelText("Add files"),
      new File(["png"], "proof.png", { type: "image/png" }),
    );
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Post answer" }));
  expect(
    await within(student).findByText(/proof.png: storage_unavailable/),
  ).toBeTruthy();
  expect(creates).toBe(1);
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Retry attachments" }));
  await waitFor(() => expect(uploads).toBe(2));
  expect(creates).toBe(1);
  expect(
    await within(student).findByRole("img", { name: "proof.png" }),
  ).toBeTruthy();
});

it("retains current attachments when an independent answer draft explicitly overwrites a conflict", async () => {
  const image = {
    id: "image-1",
    fileName: "diagram.png",
    mediaType: "image/png",
    sizeBytes: 3,
    createdAt: "2026-10-19T00:00:00Z",
    downloadUrl: "/api/v1/attachments/image-1/download",
  };
  const document = {
    ...image,
    id: "document-1",
    fileName: "proof.docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    downloadUrl: "/api/v1/attachments/document-1/download",
  };
  const patches: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(init);
        return patches.length === 1
          ? error("version_conflict", 412)
          : json({
              data: answer({
                bodyMarkdown: "My **saved** answer",
                version: 3,
                attachments: [image, document],
              }),
            });
      }
      if (url === "/api/v1/answers/a1")
        return json({
          data: answer({
            bodyMarkdown: "Peer correction",
            version: 2,
            attachments: [image, document],
          }),
        });
      return answers([
        answer({ bodyMarkdown: "Original", attachments: [image] }),
      ]);
    }),
  );
  render(<AnswerSections {...props} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit answer" }));
  const editor = screen.getByRole("textbox", { name: "Answer" });
  await user.click(editor);
  await user.keyboard("{Control>}a{/Control}My **saved** answer");
  expect(patches).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  const conflict = await screen.findByRole("region", {
    name: "Answer conflict",
  });
  expect(within(conflict).getByText("Peer correction")).toBeTruthy();
  expect(
    within(conflict).getByRole("link", { name: "proof.docx" }),
  ).toBeTruthy();
  await user.click(
    within(conflict).getByRole("button", { name: "Overwrite with my draft" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Answer conflict" }),
    ).toBeNull(),
  );
  expect((patches[1].headers as Record<string, string>)["If-Match"]).toBe(
    '"v2"',
  );
  expect(JSON.parse(patches[1].body as string)).toEqual({
    bodyMarkdown: "My **saved** answer",
  });
  expect(screen.getByText("saved").tagName).toBe("STRONG");
  expect(screen.getByRole("img", { name: "diagram.png" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "proof.docx" })).toBeTruthy();
});
