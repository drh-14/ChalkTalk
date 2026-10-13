import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AnswerSections, FollowupSections } from "./views.js";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const answer = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  postId: "p1",
  deleted: false,
  bodyMarkdown: "First **answer**",
  contributors: [{ id: "u1", displayName: "Ada" }],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
  ...overrides,
});
const followup = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  postId: "p1",
  parentId: null,
  author: { id: "u1", displayName: "Ada" },
  anonymous: false,
  bodyMarkdown: "A question",
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const props = {
  postId: "p1",
  role: "student" as const,
  courseStatus: "active" as const,
  csrfToken: "csrf",
};

it("shows multiple generic answer cards and editor names subject to anonymity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        data: [
          answer(),
          answer({
            id: "a2",
            bodyMarkdown: "Second",
            contributors: null,
            anonymous: true,
          }),
        ],
      }),
    ),
  );
  render(<AnswerSections {...props} />);
  expect(
    await screen.findByRole("region", { name: "Answer by Ada" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Answer by Anonymous" }),
  ).toBeTruthy();
  expect(screen.queryByText("Students' answer")).toBeNull();
  expect(screen.getByText("answer")).toBeTruthy();
});

it("toggles an answer vote beneath its text", async () => {
  const calls: { url: string; method?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (init?.method === "PUT")
        return json({ data: answer({ upvoteCount: 1, viewerUpvoted: true }) });
      return json({ data: [answer()] });
    }),
  );
  render(<AnswerSections {...props} />);
  const card = await screen.findByRole("region", { name: "Answer by Ada" });
  await userEvent
    .setup()
    .click(within(card).getByRole("button", { name: "Upvote answer" }));
  expect(
    within(card).getByRole("button", { name: "Remove upvote from answer" })
      .textContent,
  ).toContain("1");
  expect(calls).toContainEqual({
    url: "/api/v1/answers/a1/upvote",
    method: "PUT",
  });
});

it("keeps a posted answer when the earlier list request resolves", async () => {
  let finishInitial!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ data: answer({ id: "a2", bodyMarkdown: "New answer" }) }, 201)
        : new Promise<Response>((resolve) => {
            finishInitial = resolve;
          }),
    ),
  );
  render(<AnswerSections {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Write an answer" }));
  await user.type(
    screen.getByRole("textbox", { name: "Answer" }),
    "New answer",
  );
  await user.click(screen.getByRole("button", { name: "Post answer" }));
  expect(await screen.findByText("New answer")).toBeTruthy();
  finishInitial(json({ data: [answer({ bodyMarkdown: "Existing answer" })] }));
  expect(await screen.findByText("Existing answer")).toBeTruthy();
  expect(screen.getByText("New answer")).toBeTruthy();
  expect(screen.getAllByRole("region", { name: "Answer by Ada" })).toHaveLength(
    2,
  );
});

it("renders followup replies with their own upvotes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/replies")
        ? json({
            data: [
              followup({ id: "f2", parentId: "f1", bodyMarkdown: "Reply" }),
            ],
            meta: { total: 1, nextCursor: null },
          })
        : json({
            data: [followup({ replyCount: 1 })],
            meta: { total: 1, nextCursor: null },
          }),
    ),
  );
  render(<FollowupSections {...props} />);
  const root = await screen.findByLabelText("Followup by Ada");
  await userEvent
    .setup()
    .click(within(root).getByRole("button", { name: "Show 1 replies" }));
  expect(
    await within(screen.getByLabelText("Replies")).findByText("Reply", {
      selector: "p",
    }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: "Upvote followup" }),
  ).toHaveLength(2);
});

it.each([
  { parentId: null, load: "Load more discussions", submit: "Post followup" },
  { parentId: "f1", load: "Load more replies", submit: "Post reply" },
])(
  "keeps the $load cursor and creation order after local creation",
  async ({ parentId, load, submit }) => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (init?.method === "POST")
          return json(
            {
              data: followup({
                id: "a-new",
                parentId,
                bodyMarkdown: "New",
                createdAt: "2026-10-01T00:00:00.000300Z",
              }),
            },
            201,
          );
        if (url.includes("?cursor="))
          return json({
            data: [
              followup({
                id: "z-later",
                parentId,
                bodyMarkdown: "Later",
                createdAt: "2026-10-01T00:00:00.000200Z",
              }),
              followup({
                id: "a-new",
                parentId,
                bodyMarkdown: "New",
                createdAt: "2026-10-01T00:00:00.000300Z",
              }),
            ],
            meta: { total: 3, nextCursor: null },
          });
        if (url.endsWith("/replies"))
          return json({
            data: [
              followup({
                id: "f-first",
                parentId: "f1",
                bodyMarkdown: "First",
                createdAt: "2026-10-01T00:00:00.000100Z",
              }),
            ],
            meta: { total: 2, nextCursor: "next-page" },
          });
        return json({
          data: [
            followup({
              bodyMarkdown: parentId ? "A question" : "First",
              createdAt: "2026-10-01T00:00:00.000100Z",
              replyCount: parentId ? 2 : 0,
            }),
          ],
          meta: {
            total: parentId ? 1 : 2,
            nextCursor: parentId ? null : "next-page",
          },
        });
      }),
    );
    render(<FollowupSections {...props} />);
    const user = userEvent.setup();
    const root = await screen.findByLabelText("Followup by Ada");
    if (parentId)
      await user.click(
        within(root).getByRole("button", { name: "Show 2 replies" }),
      );
    await user.click(
      parentId
        ? within(root).getAllByRole("button", { name: "Reply" })[0]
        : screen.getByRole("button", {
            name: "Compose a new followup discussion",
          }),
    );
    await user.type(screen.getByRole("textbox", { name: "Followup" }), "New");
    await user.click(screen.getByRole("button", { name: submit }));
    expect(await screen.findByRole("button", { name: load })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: load }));
    expect(calls).toContain(
      parentId
        ? "/api/v1/followups/f1/replies?cursor=next-page"
        : "/api/v1/posts/p1/followups?cursor=next-page",
    );
    expect(await screen.findByText("Later")).toBeTruthy();
    expect(screen.getAllByText("New")).toHaveLength(1);
    expect(
      screen
        .getAllByText(/^(First|Later|New)$/)
        .map((item) => item.textContent),
    ).toEqual(["First", "Later", "New"]);
  },
);

it("removes expanded deleted ancestors after their last live reply is deleted", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url === "/api/v1/followups/f1/replies")
        return json({
          data: [
            followup({
              id: "f2",
              parentId: "f1",
              deleted: true,
              bodyMarkdown: null,
              replyCount: 1,
            }),
          ],
          meta: { total: 1, nextCursor: null },
        });
      if (url === "/api/v1/followups/f2/replies")
        return json({
          data: [followup({ id: "f3", parentId: "f2", bodyMarkdown: "Leaf" })],
          meta: { total: 1, nextCursor: null },
        });
      return json({
        data: [followup({ deleted: true, bodyMarkdown: null, replyCount: 1 })],
        meta: { total: 1, nextCursor: null },
      });
    }),
  );
  render(<FollowupSections {...props} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Show 1 replies" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Show 1 replies" }),
  );
  const leaf = await screen.findByText("Leaf");
  await user.click(
    within(leaf.closest("article")!).getByRole("button", {
      name: "Delete followup",
    }),
  );
  expect(await screen.findByText("0 Followup Discussions")).toBeTruthy();
  expect(screen.queryByText("This followup was deleted.")).toBeNull();
});

it("loads older replies after posting before opening the thread", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (init?.method === "POST")
        return json(
          {
            data: followup({
              id: "new",
              parentId: "f1",
              bodyMarkdown: "New reply",
            }),
          },
          201,
        );
      if (url.endsWith("/replies"))
        return json({
          data: [
            followup({
              id: "old",
              parentId: "f1",
              bodyMarkdown: "Older reply",
            }),
            followup({ id: "new", parentId: "f1", bodyMarkdown: "New reply" }),
          ],
          meta: { total: 2, nextCursor: null },
        });
      return json({
        data: [followup({ replyCount: 1 })],
        meta: { total: 1, nextCursor: null },
      });
    }),
  );
  render(<FollowupSections {...props} />);
  const user = userEvent.setup();
  const root = await screen.findByLabelText("Followup by Ada");
  await user.click(within(root).getByRole("button", { name: "Reply" }));
  await user.type(
    screen.getByRole("textbox", { name: "Followup" }),
    "New reply",
  );
  await user.click(screen.getByRole("button", { name: "Post reply" }));
  await user.click(
    await within(root).findByRole("button", { name: "Show 2 replies" }),
  );
  expect(await screen.findByText("Older reply")).toBeTruthy();
  expect(screen.getAllByText("New reply")).toHaveLength(1);
  expect(calls).toContain("/api/v1/followups/f1/replies");
});

it("reloads roots after creation while the initial page is pending", async () => {
  let finishInitial!: (value: Response) => void;
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return json(
          { data: followup({ id: "new", bodyMarkdown: "New discussion" }) },
          201,
        );
      reads += 1;
      if (reads === 1)
        return new Promise<Response>((resolve) => {
          finishInitial = resolve;
        });
      return json({
        data: [
          followup({ id: "old", bodyMarkdown: "Existing discussion" }),
          followup({ id: "new", bodyMarkdown: "New discussion" }),
        ],
        meta: { total: 2, nextCursor: null },
      });
    }),
  );
  render(<FollowupSections {...props} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Compose a new followup discussion" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Followup" }),
    "New discussion",
  );
  await user.click(screen.getByRole("button", { name: "Post followup" }));
  expect(await screen.findByText("Existing discussion")).toBeTruthy();
  expect(screen.getByText("New discussion")).toBeTruthy();
  expect(screen.getByText("2 Followup Discussions")).toBeTruthy();
  finishInitial(json({ data: [], meta: { total: 0, nextCursor: null } }));
});

it("keeps a failed answer draft and offers refresh on a stale edit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json({ error: { code: "version_conflict", message: "Changed" } }, 412)
        : json({ data: [answer()] }),
    ),
  );
  render(<AnswerSections {...props} />);
  const card = await screen.findByRole("region", { name: "Answer by Ada" });
  await userEvent
    .setup()
    .click(within(card).getByRole("button", { name: "Edit answer" }));
  const editor = within(card).getByRole("textbox", { name: "Answer" });
  editor.textContent = "My draft";
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await userEvent
    .setup()
    .click(within(card).getByRole("button", { name: "Save answer" }));
  expect(
    await within(card).findByRole("button", { name: "Refresh content" }),
  ).toBeTruthy();
  expect(
    within(card).getByRole("textbox", { name: "Answer" }).textContent,
  ).toContain("My draft");
});
