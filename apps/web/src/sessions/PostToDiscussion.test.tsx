import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PostToDiscussion, type PostContent } from "./PostToDiscussion.js";

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const answer = (version: number, bodyMarkdown = "Existing answer") => ({
  id: "a-1",
  postId: "p-1",
  kind: "staff",
  deleted: false,
  bodyMarkdown,
  contributors: [],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
  version,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
});

type Call = {
  url: string;
  method: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
};

function api(routes: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body,
        headers: init?.headers,
      };
      calls.push(call);
      return (
        routes(call) ??
        json({ error: { code: "unexpected", message: url } }, 500)
      );
    }),
  );
  return calls;
}

function dialog(content: PostContent, staff = false) {
  const onNavigate = vi.fn();
  render(
    <PostToDiscussion
      postId="p-1"
      postPath="/courses/c-1/posts/p-1"
      sessionTitle="Loops"
      staff={staff}
      csrfToken="csrf"
      content={content}
      onClose={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  return onNavigate;
}

const code: PostContent = {
  kind: "code",
  code: "while True:\n    break",
  language: "python",
};
const bodyOf = (call: Call) => JSON.parse(String(call.body)).bodyMarkdown;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("posts code as a followup with the note and a fenced block", async () => {
  const calls = api((call) =>
    call.url === "/api/v1/posts/p-1/followups" && call.method === "POST"
      ? json({ data: { id: "f-1" } }, 201)
      : undefined,
  );
  const onNavigate = dialog(code);
  expect(screen.queryByRole("radio", { name: "Staff answer" })).toBeNull();
  await userEvent.type(screen.getByLabelText("Note (optional)"), "Fixed it");
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByText(/Posted/)).toBeTruthy();
  const post = calls.find((call) => call.method === "POST")!;
  expect(JSON.parse(String(post.body))).toEqual({
    bodyMarkdown: "Fixed it\n\n```python\nwhile True:\n    break\n```",
    anonymous: false,
  });
  await userEvent.click(screen.getByRole("link", { name: "View the post" }));
  expect(onNavigate).toHaveBeenCalledWith("/courses/c-1/posts/p-1");
});

it("appends to an existing staff answer, retrying once after a conflict", async () => {
  let patches = 0;
  const calls = api((call) => {
    if (call.url === "/api/v1/posts/p-1/answers" && call.method === "GET")
      return json({ data: [answer(3)] });
    if (call.url === "/api/v1/answers/a-1" && call.method === "GET")
      return json({ data: answer(4, "Edited meanwhile") }, 200, {
        ETag: '"v4"',
      });
    if (call.url === "/api/v1/answers/a-1" && call.method === "PATCH") {
      patches += 1;
      return patches === 1
        ? json({ error: { code: "version_conflict", message: "Changed" } }, 412)
        : json({ data: answer(5) }, 200, { ETag: '"v5"' });
    }
    return undefined;
  });
  dialog(code, true);
  await userEvent.click(screen.getByRole("radio", { name: "Staff answer" }));
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByText(/Posted/)).toBeTruthy();
  const [first, second] = calls.filter((call) => call.method === "PATCH");
  expect(bodyOf(first!)).toBe(
    "Existing answer\n\n```python\nwhile True:\n    break\n```",
  );
  expect(first!.headers).toMatchObject({ "If-Match": '"v3"' });
  expect(bodyOf(second!)).toBe(
    "Edited meanwhile\n\n```python\nwhile True:\n    break\n```",
  );
  expect(second!.headers).toMatchObject({ "If-Match": '"v4"' });
});

it("creates the staff answer when the question has none", async () => {
  const calls = api((call) => {
    if (call.url === "/api/v1/posts/p-1/answers" && call.method === "GET")
      return json({ data: [] });
    if (call.url === "/api/v1/posts/p-1/answers" && call.method === "POST")
      return json({ data: answer(1) }, 201);
    return undefined;
  });
  dialog(code, true);
  await userEvent.click(screen.getByRole("radio", { name: "Staff answer" }));
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByText(/Posted/)).toBeTruthy();
  const created = calls.find(
    (call) =>
      call.url === "/api/v1/posts/p-1/answers" && call.method === "POST",
  )!;
  expect(bodyOf(created)).toBe("```python\nwhile True:\n    break\n```");
});

it("posts the board as a followup with the PNG attached", async () => {
  const calls = api((call) => {
    if (call.url === "/api/v1/posts/p-1/followups" && call.method === "POST")
      return json({ data: { id: "f-9" } }, 201);
    if (call.url === "/api/v1/followups/f-9/attachments")
      return json({ data: { id: "att-1" } }, 201);
    return undefined;
  });
  const file = new File(["png"], "loops-whiteboard.png", { type: "image/png" });
  dialog({ kind: "board", file });
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByText(/Posted/)).toBeTruthy();
  const followup = calls.find((call) => call.url.endsWith("/followups"))!;
  expect(bodyOf(followup)).toBe('Whiteboard from the live session "Loops".');
  const upload = calls.find((call) => call.url.endsWith("/attachments"))!;
  expect((upload.body as FormData).get("file")).toBe(file);
});

it("keeps the dialog open with the error when posting fails", async () => {
  api((call) =>
    call.method === "POST"
      ? json({ error: { code: "validation_failed", message: "Too long" } }, 422)
      : undefined,
  );
  dialog(code);
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Too long");
  expect(screen.getByRole("button", { name: "Post" })).toBeTruthy();
});
