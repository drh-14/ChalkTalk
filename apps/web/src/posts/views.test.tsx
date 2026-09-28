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
import { Discussion } from "./views.js";

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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
  await user.click(
    within(feed).getByRole("radio", { name: "Duplicate posts" }),
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
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
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
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
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
            bodyMarkdown: "Private retained body",
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
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
  );
  await user.click(await screen.findByRole("button", { name: "Old question" }));
  const card = screen
    .getByRole("button", { name: "Old question" })
    .closest(".post-card");
  expect(card?.classList.contains("post-card")).toBe(true);
  expect(card?.classList.contains("selected")).toBe(true);
  const detail = screen.getByRole("region", { name: "Post detail" });
  expect(detail.textContent).toContain("Private retained body");
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
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
  );
  await user.click(await screen.findByRole("button", { name: "Old question" }));
  await waitFor(() => expect(finishReview).toBeDefined());
  await user.click(screen.getByRole("radio", { name: "Posts" }));
  finishReview!(
    json({
      data: {
        ...post("merged-1", "Old question"),
        bodyMarkdown: "Secret retained text",
      },
    }),
  );
  await screen.findByText("No posts yet.");
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
  await screen.findByText("No posts yet.");
  expect(screen.queryByRole("group", { name: "Post view" })).toBeNull();
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
  await user.click(screen.getByRole("radio", { name: "Duplicate posts" }));
  expect(
    screen.getByRole("heading", { name: "Select a duplicate post" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Merge as duplicate" }),
  ).toBeNull();
  await user.click(screen.getByRole("radio", { name: "Posts" }));
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
  expect(description?.classList.contains("visually-hidden")).toBe(false);
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
  await user.click(
    within(screen.getByRole("region", { name: "Post listings" })).getByRole(
      "link",
      { name: /First question/ },
    ),
  );
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
  await user.click(
    within(screen.getByRole("region", { name: "Post listings" })).getByRole(
      "link",
      { name: /First question/ },
    ),
  );
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
  expect(screen.getByRole("textbox", { name: "Post body" })).toHaveProperty(
    "value",
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
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await screen.findByText("Try again");
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toBe("My question");
  await user.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/courses/course-1/posts/new-post"),
  );
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
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
              "<script>alert(1)</script>\n\n[bad](javascript:alert(1)) **good**",
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
  await user.click(screen.getByRole("textbox", { name: "Post title" }));
  await user.paste("x".repeat(201));
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toHaveLength(201);
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
  fireEvent.change(screen.getByRole("textbox", { name: "Post body" }), {
    target: { value: "b".repeat(100001) },
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
  fireEvent.change(screen.getByRole("textbox", { name: "Post body" }), {
    target: { value: `bodyterm ${"z".repeat(99990)}` },
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

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();
const postsUrl = (urls: string[]) =>
  urls
    .filter((url) => url.startsWith("/api/v1/courses/course-1/posts"))
    .map((url) => new URL(url, "https://example.edu"));

it("shows compact rows with relative time, tags, and status badges", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      page([
        {
          ...post("n1", "Pinned note"),
          type: "note",
          pinned: true,
          tags: ["syllabus"],
          createdAt: hoursAgo(2),
        },
        {
          ...post("q1", "Open question"),
          answered: false,
          pinned: false,
          createdAt: hoursAgo(26),
          author: {
            userId: "u1",
            displayName: "Grace Hopper",
            anonymous: false,
            deleted: false,
          },
        },
      ]),
    ),
  );
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      onNavigate={vi.fn()}
    />,
  );
  const note = (await screen.findByText("Pinned note")).closest("li")!;
  expect(within(note).getByText("note")).toBeTruthy();
  expect(within(note).getByText("Pinned")).toBeTruthy();
  expect(within(note).queryByText("Unanswered")).toBeNull();
  expect(within(note).getByText("2 hours ago")).toBeTruthy();
  expect(note.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
  expect(
    within(note).getByRole("button", { name: "Filter by tag syllabus" }),
  ).toBeTruthy();
  const question = screen.getByText("Open question").closest("li")!;
  expect(within(question).getByText("Unanswered")).toBeTruthy();
  expect(within(question).queryByText("Pinned")).toBeNull();
  expect(within(question).getByText("yesterday")).toBeTruthy();
  expect(within(question).getByText("Grace Hopper")).toBeTruthy();
  expect(within(question).getByText(/A useful explanation/)).toBeTruthy();
});

it("distinguishes an empty course from filters that match nothing and clears them", async () => {
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
  await screen.findByText("No posts yet.");
  expect(
    screen.queryByRole("button", { name: "Clear search and filters" }),
  ).toBeNull();
  await user.click(screen.getByRole("radio", { name: "Notes" }));
  await screen.findByText("Nothing matches this search or these filters.");
  await user.click(
    screen.getByRole("button", { name: "Clear search and filters" }),
  );
  await screen.findByText("No posts yet.");
  expect(
    (screen.getByRole("radio", { name: "All posts" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
});

it("requests the documented list parameters for each filter and sort", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return page([]);
    }),
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
  await screen.findByText("No posts yet.");
  expect(postsUrl(urls).at(-1)!.search).toBe("");
  const last = () => Object.fromEntries(postsUrl(urls).at(-1)!.searchParams);
  await user.click(screen.getByRole("radio", { name: "Questions" }));
  await waitFor(() => expect(last()).toEqual({ type: "question" }));
  await user.click(screen.getByRole("radio", { name: "Notes" }));
  await waitFor(() => expect(last()).toEqual({ type: "note" }));
  await user.click(screen.getByRole("radio", { name: "Unanswered" }));
  await waitFor(() => expect(last()).toEqual({ answered: "false" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort posts" }),
    "Newest",
  );
  await waitFor(() =>
    expect(last()).toEqual({ answered: "false", sort: "newest" }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort posts" }),
    "Recent activity",
  );
  await waitFor(() =>
    expect(last()).toEqual({ answered: "false", sort: "recent_activity" }),
  );
  await user.click(screen.getByRole("radio", { name: "All posts" }));
  await waitFor(() => expect(last()).toEqual({ sort: "recent_activity" }));
  expect(
    (screen.getByRole("radio", { name: "All posts" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
});

it("uses relevance and disables sorting while a search is applied", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return page([]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="cutoff"
      filters={{ type: "note", sort: "newest" }}
      onFiltersChange={vi.fn()}
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("No posts found.");
  const sort = screen.getByRole("combobox", {
    name: "Sort posts",
  }) as HTMLSelectElement;
  expect(sort.disabled).toBe(true);
  expect(sort.value).toBe("relevance");
  expect(Object.fromEntries(postsUrl(urls)[0]!.searchParams)).toEqual({
    q: "cutoff",
    sort: "relevance",
    type: "note",
  });
});

it("restores filters from the URL and preserves them on post links", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return page([post("p1", "First")]);
    }),
  );
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      filters={{ type: "note", sort: "newest" }}
      onFiltersChange={vi.fn()}
      onNavigate={navigate}
    />,
  );
  await screen.findByText("First");
  expect(Object.fromEntries(postsUrl(urls)[0]!.searchParams)).toEqual({
    sort: "newest",
    type: "note",
  });
  expect(
    (screen.getByRole("radio", { name: "Notes" }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(
    (screen.getByRole("combobox", { name: "Sort posts" }) as HTMLSelectElement)
      .value,
  ).toBe("newest");
  await user.click(screen.getByRole("link", { name: /First/ }));
  expect(navigate).toHaveBeenCalledWith(
    "/courses/course-1/posts/p1?type=note&sort=newest",
  );
});

it("filters by a tag from a row, keeps the selected post, and removes the tag", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url === "/api/v1/posts/p1")
        return json({ data: { ...post("p1", "Selected"), tags: ["midterm"] } });
      return page([{ ...post("p1", "Selected"), tags: ["midterm"] }]);
    }),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      postId="p1"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Selected" });
  const row = screen.getByRole("link", { name: /Selected/ }).closest("li")!;
  await user.click(
    within(row).getByRole("button", { name: "Filter by tag midterm" }),
  );
  await waitFor(() =>
    expect(postsUrl(urls).at(-1)!.searchParams.get("tag")).toBe("midterm"),
  );
  expect(screen.getByRole("heading", { name: "Selected" })).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Remove tag filter midterm" }),
  );
  await waitFor(() =>
    expect(postsUrl(urls).at(-1)!.searchParams.has("tag")).toBe(false),
  );
  expect(
    screen.queryByRole("button", { name: "Remove tag filter midterm" }),
  ).toBeNull();
});

it("ignores a late response for a previous filter", async () => {
  let releaseQuestions: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("type=question"))
        return new Promise<Response>((resolve) => {
          releaseQuestions = () =>
            resolve(page([post("old", "Late question")]));
        });
      if (url.includes("type=note"))
        return Promise.resolve(
          page([{ ...post("n1", "Current note"), type: "note" }]),
        );
      return Promise.resolve(page([]));
    }),
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
  await screen.findByText("No posts yet.");
  await user.click(screen.getByRole("radio", { name: "Questions" }));
  await waitFor(() => expect(releaseQuestions).toBeDefined());
  await user.click(screen.getByRole("radio", { name: "Notes" }));
  await screen.findByText("Current note");
  releaseQuestions!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("Late question")).toBeNull();
  expect(screen.getByText("Current note")).toBeTruthy();
});

it("keeps an open draft when filters change and hides filters for duplicate review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/members/user-staff")
        ? json({ data: { role: "ta" } })
        : page([]),
    ),
  );
  const confirm = vi.spyOn(window, "confirm");
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
  await user.click(await screen.findByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "Unsent draft",
  );
  await user.click(screen.getByRole("radio", { name: "Notes" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toBe("Unsent draft");
  expect(screen.getByRole("complementary", { name: "Filters" })).toBeTruthy();
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
  );
  expect(screen.queryByRole("complementary", { name: "Filters" })).toBeNull();
});

function pinFixture(options: {
  role?: "ta" | "student";
  status?: "active" | "archived";
  patch?: (init: RequestInit) => Promise<Response>;
}) {
  let version = 3;
  let pinned = false;
  const calls: { url: string; init?: RequestInit }[] = [];
  const current = () => ({ ...post("p1", "Pin me"), version, pinned });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/members/user-1"))
        return json({ data: { role: options.role ?? "ta" } });
      if (url === "/api/v1/posts/p1" && init?.method === "PATCH") {
        if (options.patch) return options.patch(init);
        pinned = JSON.parse(String(init.body)).pinned;
        version += 1;
        return json({ data: current() });
      }
      if (url === "/api/v1/posts/p1") return json({ data: current() });
      return page([current()]);
    }),
  );
  render(
    <Discussion
      courseId={course.id}
      course={{ ...course, status: options.status ?? "active" }}
      csrfToken="csrf"
      userId="user-1"
      postId="p1"
      onNavigate={vi.fn()}
    />,
  );
  return calls;
}

it("lets staff pin and unpin a post with conditional requests and updates its row", async () => {
  const calls = pinFixture({});
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Pin" }));
  await screen.findByRole("button", { name: "Unpin" });
  const patch = calls.find((call) => call.init?.method === "PATCH")!;
  expect(patch.init?.headers).toMatchObject({
    "X-CSRF-Token": "csrf",
    "If-Match": '"v3"',
  });
  expect(patch.init?.body).toBe(JSON.stringify({ pinned: true }));
  const row = screen.getByRole("link", { name: /Pin me/ }).closest("li")!;
  expect(within(row).getByText("Pinned")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Unpin" }));
  await screen.findByRole("button", { name: "Pin" });
  const patches = calls.filter((call) => call.init?.method === "PATCH");
  expect(patches[1]!.init?.headers).toMatchObject({ "If-Match": '"v4"' });
  expect(within(row).queryByText("Pinned")).toBeNull();
});

it("disables pinning while pending and refetches after a stale revision", async () => {
  let reject!: () => void;
  const calls = pinFixture({
    patch: () =>
      new Promise<Response>((resolve) => {
        reject = () =>
          resolve(
            json(
              {
                error: {
                  code: "version_conflict",
                  message: "This post changed. Try again.",
                },
              },
              412,
            ),
          );
      }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Pin" }));
  expect(
    (screen.getByRole("button", { name: "Pinning…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  reject();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This post changed. Try again.",
  );
  await screen.findByRole("button", { name: "Pin" });
  expect(
    calls.filter(
      (call) => call.url === "/api/v1/posts/p1" && !call.init?.method,
    ),
  ).toHaveLength(2);
});

it("hides pinning from students and in archived courses", async () => {
  pinFixture({ role: "student" });
  await screen.findByRole("heading", { name: "Pin me" });
  expect(screen.queryByRole("group", { name: "Staff actions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
  cleanup();
  pinFixture({ status: "archived" });
  await screen.findByRole("button", { name: "Merge as duplicate" });
  expect(screen.getByRole("group", { name: "Staff actions" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
});

it("prompts to choose or start a post when nothing is selected", async () => {
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
  expect(
    await screen.findByText(
      "Choose a question or note from the list to read it here.",
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Start a new post" }));
  expect(screen.getByRole("textbox", { name: "Post title" })).toBeTruthy();
});

it("returns from a post to the list with the same search and filters", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/v1/posts/p1"
        ? json({ data: post("p1", "Open post") })
        : page([post("p1", "Open post")]),
    ),
  );
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      postId="p1"
      query="cutoff"
      filters={{ tag: "midterm" }}
      onFiltersChange={vi.fn()}
      onNavigate={navigate}
    />,
  );
  await screen.findByRole("heading", { name: "Open post" });
  await user.click(screen.getByRole("button", { name: /Back to posts/ }));
  expect(navigate).toHaveBeenCalledWith(
    "/courses/course-1?q=cutoff&tag=midterm",
  );
});

it("shows staff a Post view toggle with the selected option exposed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/members/user-staff")
        ? json({ data: { role: "ta" } })
        : page([]),
    ),
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
  const toggle = await screen.findByRole("group", { name: "Post view" });
  const posts = within(toggle).getByRole("radio", { name: "Posts" });
  const duplicates = within(toggle).getByRole("radio", {
    name: "Duplicate posts",
  });
  expect((posts as HTMLInputElement).checked).toBe(true);
  await user.click(duplicates);
  expect((duplicates as HTMLInputElement).checked).toBe(true);
  expect((posts as HTMLInputElement).checked).toBe(false);
});

it("clears an applied search with the Clear search control and refocuses the field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([post("p1", "Cutoff post")])),
  );
  const onQueryChange = vi.fn();
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="cutoff"
      onQueryChange={onQueryChange}
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Cutoff post");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  const searchbox = screen.getByRole("searchbox", { name: "Search posts" });
  expect(onQueryChange).toHaveBeenCalledWith("");
  expect((searchbox as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(searchbox);
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

it("focuses search on slash except while typing in a field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([post("p1", "Row")])),
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
  const row = await screen.findByRole("link", { name: /Row/ });
  row.focus();
  await user.keyboard("/");
  const searchbox = screen.getByRole("searchbox", { name: "Search posts" });
  expect(document.activeElement).toBe(searchbox);
  expect((searchbox as HTMLInputElement).value).toBe("");
  await user.click(screen.getByRole("button", { name: "Create post" }));
  const title = screen.getByRole("textbox", { name: "Post title" });
  await user.type(title, "a/b");
  expect(document.activeElement).toBe(title);
  expect((title as HTMLInputElement).value).toBe("a/b");
});

it("states the loaded result count for an applied search", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("q=integration")
        ? page(["a", "b", "c", "d"].map((id) => post(id, `Result ${id}`)))
        : url.includes("q=limits")
          ? page([post("e", "Only one")], "next")
          : page([post("f", "Single")]),
    ),
  );
  const { rerender } = render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="integration"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Result d");
  const count = document.querySelector(".result-count")!;
  expect(count.getAttribute("aria-live")).toBe("polite");
  expect(count.textContent).toBe('4 results for "integration"');
  rerender(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="limits"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Only one");
  expect(document.querySelector(".result-count")!.textContent).toBe(
    '1+ results for "limits"',
  );
  rerender(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="single"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Single");
  expect(document.querySelector(".result-count")!.textContent).toBe(
    '1 result for "single"',
  );
});

it("asks an unmatched search as a new question with the body focused", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return page([]);
    }),
  );
  const confirm = vi.spyOn(window, "confirm");
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="integration by parts u choice"
      onNavigate={vi.fn()}
    />,
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Ask “integration by parts u choice” as a new question",
    }),
  );
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toBe("integration by parts u choice");
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Post body" }),
  );
  expect(screen.getByDisplayValue("Question").tagName).toBe("SELECT");
  await waitFor(() =>
    expect(
      urls.some(
        (url) =>
          url.includes("type=question") &&
          url.includes("limit=10") &&
          url.includes("q=integration+OR+by+OR+parts"),
      ),
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Close composer" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Post title" })).toBeNull();
});

it("offers asking after results, limits the title, and respects an open draft", async () => {
  const longQuery = `limits ${"x".repeat(240)}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([post("p1", "Existing answer")])),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query={longQuery}
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("Existing answer");
  expect(screen.getByText("Didn’t find what you need?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create post" }));
  await user.type(
    screen.getByRole("textbox", { name: "Post title" }),
    "My own draft",
  );
  const ask = screen.getByRole("button", { name: /as a new question/ });
  await user.click(ask);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement)
      .value,
  ).toBe("My own draft");
  confirm.mockReturnValue(true);
  await user.click(ask);
  const title = (
    screen.getByRole("textbox", { name: "Post title" }) as HTMLInputElement
  ).value;
  expect(title).toBe(longQuery.slice(0, 200));
  expect(title).toHaveLength(200);
});

it("does not offer asking in archived courses or duplicate review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/members/user-staff")
        ? json({ data: { role: "ta" } })
        : page([]),
    ),
  );
  const user = userEvent.setup();
  render(
    <Discussion
      courseId={course.id}
      course={{ ...course, status: "archived" }}
      csrfToken="csrf"
      query="cutoff"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("No posts found.");
  expect(
    screen.queryByRole("button", { name: /as a new question/ }),
  ).toBeNull();
  cleanup();
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      userId="user-staff"
      query="cutoff"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: /as a new question/ });
  await user.click(
    await screen.findByRole("radio", { name: "Duplicate posts" }),
  );
  await screen.findByText("No duplicate posts found.");
  expect(
    screen.queryByRole("button", { name: /as a new question/ }),
  ).toBeNull();
});

it("leaves an unmatched search to the no-match state instead of a zero count", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => page([])),
  );
  render(
    <Discussion
      courseId={course.id}
      course={course}
      csrfToken="csrf"
      query="nothing"
      onNavigate={vi.fn()}
    />,
  );
  await screen.findByText("No posts found.");
  expect(document.querySelector(".result-count")!.textContent).toBe("");
});
