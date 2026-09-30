import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AnswerSections } from "./views.js";

const answer = (overrides: Record<string, unknown> = {}) => ({
  id: "answer-1",
  postId: "post-1",
  kind: "student",
  deleted: false,
  bodyMarkdown: "Use the **ratio** test.",
  contributors: [{ id: "user-1", displayName: "Ada Lovelace" }],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-09-28T09:00:00Z",
  updatedAt: "2026-09-28T09:00:00Z",
  version: 1,
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const failure = (code: string, status: number) =>
  json({ error: { code, message: `Failed: ${code}` } }, status);
function renderSections(
  role: "student" | "ta" | "instructor",
  courseStatus: "active" | "archived" = "active",
) {
  return render(
    <AnswerSections
      postId="post-1"
      role={role}
      courseStatus={courseStatus}
      csrfToken="csrf"
    />,
  );
}
const section = (name: string) => screen.getByRole("region", { name });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("shows loading, then both sections with an answer and an empty state", async () => {
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        data: [
          answer({
            bodyMarkdown: "<script>alert(1)</script>\n\n**bold**",
            endorsedAt: "2026-09-28T10:00:00Z",
            endorsedBy: "ta-1",
          }),
        ],
      }),
    ),
  );
  renderSections("student");
  expect(screen.getByRole("status").textContent).toContain("Loading answers");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(within(students).getByText("Ada Lovelace")).toBeTruthy();
  expect(within(students).getByText("3 hours ago")).toBeTruthy();
  expect(within(students).getByText("Endorsed")).toBeTruthy();
  expect(within(students).getByText("bold")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(
    within(section("Instructors' answer")).getByText(
      "No instructors' answer yet.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Endorse/ })).toBeNull();
});

it("shows anonymous and deleted-user bylines", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        data: [
          answer({ anonymous: true, contributors: null }),
          answer({ id: "answer-2", kind: "staff", contributors: [] }),
        ],
      }),
    ),
  );
  renderSections("student");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(within(students).getByText("Anonymous")).toBeTruthy();
  expect(
    within(section("Instructors' answer")).getByText("Deleted user"),
  ).toBeTruthy();
});

it("offers retry after a load error", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(failure("internal_error", 500))
    .mockResolvedValueOnce(json({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  renderSections("student");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Answers are unavailable",
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No instructors' answer yet.")).toBeTruthy();
});

it("lets a student write the students' answer only", async () => {
  let release!: (response: Response) => void;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderSections("student");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  expect(
    within(section("Instructors' answer")).queryByRole("textbox"),
  ).toBeNull();
  expect(
    within(students).getByText(/can't be edited after you post it/),
  ).toBeTruthy();
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  expect(within(students).getByRole("alert").textContent).toContain(
    "Write an answer",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(
    within(students).getByRole("textbox", { name: "Your answer" }),
    {
      target: { value: "x".repeat(100001) },
    },
  );
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  expect(within(students).getByRole("alert").textContent).toContain("100,000");
  fireEvent.change(
    within(students).getByRole("textbox", { name: "Your answer" }),
    {
      target: { value: "Try the ratio test." },
    },
  );
  await user.click(
    within(students).getByRole("checkbox", { name: "Answer anonymously" }),
  );
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  const pending = within(students).getByRole("button", { name: "Posting…" });
  expect((pending as HTMLButtonElement).disabled).toBe(true);
  await user.click(pending);
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(posts).toHaveLength(1);
  expect(posts[0]![0]).toBe("/api/v1/posts/post-1/answers");
  expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({
    bodyMarkdown: "Try the ratio test.",
    anonymous: true,
  });
  release(
    json(
      {
        data: answer({
          bodyMarkdown: "Try the ratio test.",
          anonymous: true,
          contributors: null,
        }),
      },
      201,
    ),
  );
  expect(await within(students).findByText("Try the ratio test.")).toBeTruthy();
  expect(within(students).queryByRole("textbox")).toBeNull();
});

it("keeps the draft on failure and retries with the same idempotency key", async () => {
  const keys: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ data: [] });
    keys.push((init.headers as Record<string, string>)["Idempotency-Key"]!);
    return keys.length === 1
      ? failure("internal_error", 500)
      : json({ data: answer({ bodyMarkdown: "Draft answer" }) }, 201);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderSections("student");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await user.type(
    within(students).getByRole("textbox", { name: "Your answer" }),
    "Draft answer",
  );
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  expect((await within(students).findByRole("alert")).textContent).toContain(
    "Failed: internal_error",
  );
  expect(
    within(students).getByRole("textbox", { name: "Your answer" }),
  ).toHaveProperty("value", "Draft answer");
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  expect(await within(students).findByText("Draft answer")).toBeTruthy();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

it("reloads the answers when another student posted first", async () => {
  let lists = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return failure("answer_kind_exists", 409);
      lists += 1;
      return json({
        data: lists === 1 ? [] : [answer({ bodyMarkdown: "Posted first." })],
      });
    }),
  );
  const user = userEvent.setup();
  renderSections("student");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await user.type(
    within(students).getByRole("textbox", { name: "Your answer" }),
    "Mine",
  );
  await user.click(
    within(students).getByRole("button", { name: "Post answer" }),
  );
  expect(await within(students).findByText("Posted first.")).toBeTruthy();
  expect(within(students).queryByRole("textbox")).toBeNull();
});

it("lets staff write only the instructors' answer and endorse or delete after confirming", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PUT")
        return json({
          data: answer({
            endorsedAt: "2026-09-28T11:00:00Z",
            endorsedBy: "ta-1",
            version: 2,
          }),
        });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({
        data: [answer(), answer({ id: "answer-2", kind: "staff", version: 5 })],
      });
    }),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderSections("ta");
  const students = await screen.findByRole("region", {
    name: "Students' answer",
  });
  await user.click(
    within(students).getByRole("button", { name: "Endorse students' answer" }),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(calls.some(({ init }) => init?.method === "PUT")).toBe(false);
  confirm.mockReturnValue(true);
  await user.click(
    within(students).getByRole("button", { name: "Endorse students' answer" }),
  );
  expect(await within(students).findByText("Endorsed")).toBeTruthy();
  const put = calls.find(({ init }) => init?.method === "PUT")!;
  expect(put.url).toBe("/api/v1/answers/answer-1/endorsement");
  expect((put.init!.headers as Record<string, string>)["If-Match"]).toBe(
    '"v1"',
  );
  expect(
    within(students).queryByRole("button", { name: /Endorse|Delete/ }),
  ).toBeNull();

  const staff = section("Instructors' answer");
  await user.click(
    within(staff).getByRole("button", { name: "Delete instructors' answer" }),
  );
  const del = calls.find(({ init }) => init?.method === "DELETE")!;
  expect(del.url).toBe("/api/v1/answers/answer-2");
  expect((del.init!.headers as Record<string, string>)["If-Match"]).toBe(
    '"v5"',
  );
  expect(
    await within(staff).findByRole("textbox", { name: "Your answer" }),
  ).toBeTruthy();
  await waitFor(() =>
    expect(within(students).queryByRole("textbox")).toBeNull(),
  );
});

it("shows no answer controls in an archived course", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ data: [answer()] })),
  );
  renderSections("instructor", "archived");
  await screen.findByRole("region", { name: "Students' answer" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /Endorse|Delete/ })).toBeNull();
});
