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

it("preserves a stale answer edit draft after explicit refresh", async () => {
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
  await userEvent
    .setup()
    .click(
      within(student).getByRole("button", { name: "Use standard editor" }),
    );
  const editor = within(student).getByRole("textbox", { name: "Answer" });
  await userEvent.setup().type(editor, " Local draft");
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Save answer" }));
  expect((await within(student).findByRole("alert")).textContent).toContain(
    "Refresh",
  );
  await userEvent
    .setup()
    .click(within(student).getByRole("button", { name: "Refresh content" }));
  expect(editor.textContent).toContain("Local draft");
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
    bodyMarkdown: "New reply",
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
      "New reply",
    );
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Post reply" }));
  expect(await within(parent).findByText("New reply")).toBeTruthy();
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
              bodyMarkdown: "Staff explanation",
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
      "Staff explanation",
    );
  await userEvent
    .setup()
    .click(within(staff).getByRole("button", { name: "Post answer" }));
  expect(await within(staff).findByText("Staff explanation")).toBeTruthy();
});

it("edits and deletes an owned followup with the projected controls", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH")
        return json({
          data: followup({ bodyMarkdown: "Updated followup", version: 2 }),
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
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Use standard editor" }));
  const editor = within(parent).getByRole("textbox", { name: "Followup" });
  await userEvent.setup().click(editor);
  await userEvent.setup().keyboard("{Control>}a{/Control}Updated followup");
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Save followup" }));
  expect(await within(parent).findByText("Updated followup")).toBeTruthy();
  await userEvent
    .setup()
    .click(within(parent).getByRole("button", { name: "Delete followup" }));
  expect(
    screen.queryByRole("article", { name: "Followup by Ada Lovelace" }),
  ).toBeNull();
});
