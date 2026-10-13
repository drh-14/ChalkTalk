import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionResponses } from "./views.js";

const answer = {
  id: "a1",
  postId: "p1",
  deleted: false,
  bodyMarkdown: "Use **ratio** and $x^2$.",
  contributors: [{ id: "u1", displayName: "Ada" }],
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
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows independent answer cards and the zero-followup prompt", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/answers")
        ? json({ data: [answer] })
        : json({ data: [], meta: { total: 0, nextCursor: null } }),
    ),
  );
  render(
    <QuestionResponses
      postId="p1"
      role="student"
      courseStatus="active"
      csrfToken="csrf"
    />,
  );
  const card = await screen.findByRole("region", { name: "Answer by Ada" });
  expect(within(card).getByText("ratio")).toBeTruthy();
  expect(
    within(card).getByRole("button", { name: "Upvote answer" }).textContent,
  ).toContain("2");
  expect(await screen.findByText("0 Followup Discussions")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Compose a new followup discussion" }),
  ).toBeTruthy();
});

it("opens the shared Markdown and LaTeX composer for a followup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/answers")
        ? json({ data: [] })
        : json({ data: [], meta: { total: 0, nextCursor: null } }),
    ),
  );
  render(
    <QuestionResponses
      postId="p1"
      role="student"
      courseStatus="active"
      csrfToken="csrf"
    />,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Compose a new followup discussion",
    }),
  );
  expect(
    screen.getByRole("toolbar", { name: "Followup formatting" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Inline math" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
});
