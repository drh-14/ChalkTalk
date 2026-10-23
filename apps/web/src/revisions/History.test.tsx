import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RevisionHistory } from "./History.js";

const first = {
  id: "r1",
  ordinal: 1,
  resourceVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  title: "Original",
  bodyMarkdown: "Old body",
  baseline: true,
  restoredFromRevisionId: null,
  editor: null,
};
const second = {
  ...first,
  id: "r2",
  ordinal: 2,
  resourceVersion: 2,
  title: "Changed",
  bodyMarkdown: "New body",
  baseline: false,
};
const metadata = (revision: typeof first) => ({
  id: revision.id,
  ordinal: revision.ordinal,
  resourceVersion: revision.resourceVersion,
  createdAt: revision.createdAt,
  baseline: revision.baseline,
  restoredFromRevisionId: revision.restoredFromRevisionId,
  editor: revision.editor,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const deferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reveals saved text for a single selected version", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/r1")
        ? json({ data: first })
        : json({ data: [metadata(first)], page: { nextCursor: null } }),
    ),
  );
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={1}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 1}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  const disclosure = await screen.findByText("View version 1 text");
  expect(disclosure.closest("details")?.open).toBe(false);
  await user.click(disclosure);
  expect(disclosure.closest("details")?.open).toBe(true);
  expect(await screen.findByText("Title: Original")).toBeTruthy();
  expect(screen.getByText("Old body")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
});

it("loads later metadata and fetches only selected revision text", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith("/r2")) return json({ data: second });
      if (url.includes("cursor=1"))
        return json({ data: [metadata(second)], page: { nextCursor: null } });
      return json({ data: [metadata(first)], page: { nextCursor: "1" } });
    }),
  );
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(screen.queryByText("Old body")).toBeNull();
  await user.click(
    await screen.findByRole("button", { name: "Load more history" }),
  );
  await user.click(await screen.findByText("View version 2 text"));
  expect(await screen.findByText("New body")).toBeTruthy();
  expect(requests).toEqual([
    "/api/v1/posts/p1/revisions",
    "/api/v1/posts/p1/revisions?cursor=1",
    "/api/v1/posts/p1/revisions/r2",
  ]);
});

it("lets an authorized reader compare text without revealing anonymous editor identities", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("compare")
        ? json({ data: { left: first, right: second } })
        : json({ data: [first, second] }),
    ),
  );
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByText(/Baseline of saved text/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Compare versions" }));
  await waitFor(() =>
    expect(document.querySelector(".revision-compare")?.textContent).toContain(
      "Old body",
    ),
  );
  expect(document.querySelector(".revision-compare")?.textContent).toContain(
    "New body",
  );
  expect(screen.queryByText(/editor:/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
});

it("labels comparison text chronologically after reversed selections", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("compare")) {
        requests.push(url);
        return json({ data: { left: second, right: first } });
      }
      return json({ data: [first, second] });
    }),
  );
  const user = userEvent.setup();
  const { container } = render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.selectOptions(await screen.findByLabelText("Version A"), "r2");
  await user.selectOptions(screen.getByLabelText("Version B"), "r1");
  await user.click(screen.getByRole("button", { name: "Compare versions" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toContain("left=r2&right=r1");
  await waitFor(() =>
    expect(
      container.querySelectorAll(".revision-compare > section"),
    ).toHaveLength(2),
  );
  const columns = container.querySelectorAll(".revision-compare > section");
  expect(columns[0]?.textContent).toContain("Earlier text");
  expect(columns[0]?.textContent).toContain("Old body");
  expect(columns[1]?.textContent).toContain("Later text");
  expect(columns[1]?.textContent).toContain("New body");
});

it("retains the selected revision after a stale staff restore and offers a refresh", async () => {
  let restore = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return ++restore === 1
          ? json(
              {
                error: {
                  code: "version_conflict",
                  message: "Post version has changed",
                },
              },
              412,
            )
          : json({ data: { id: "p1", version: 4 } });
      return json({ data: [first, second] });
    }),
  );
  const refreshed = vi.fn(async () => 3);
  const onRestored = vi.fn();
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore
      csrfToken="csrf"
      onRefresh={refreshed}
      onRestored={onRestored}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", { name: "Restore version 1" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringMatching(/changed/i),
  );
  await user.click(
    screen.getByRole("button", { name: "Refresh current version" }),
  );
  await user.click(screen.getByRole("button", { name: "Restore version 1" }));
  await waitFor(() => expect(onRestored).toHaveBeenCalled());
  expect(refreshed).toHaveBeenCalledOnce();
});

it("removes previously loaded text when reopening history loses access", async () => {
  let listReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("compare"))
        return json({ data: { left: first, right: second } });
      return ++listReads === 1
        ? json({ data: [first, second] })
        : json({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  );
  const user = userEvent.setup();
  const { container } = render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", { name: "Compare versions" }),
  );
  await waitFor(() =>
    expect(container.querySelector(".revision-compare")).not.toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Not found",
  );
  expect(screen.queryByText("Old body")).toBeNull();
  expect(container.querySelector(".revision-compare")).toBeNull();
  expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
});

it("removes loaded text when a comparison read loses access", async () => {
  let comparisons = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("compare")
        ? ++comparisons === 1
          ? json({ data: { left: first, right: second } })
          : json({ error: { code: "not_found", message: "Not found" } }, 404)
        : json({ data: [first, second] }),
    ),
  );
  const user = userEvent.setup();
  const { container } = render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  const compare = await screen.findByRole("button", {
    name: "Compare versions",
  });
  await user.click(compare);
  await waitFor(() =>
    expect(container.querySelector(".revision-compare")).not.toBeNull(),
  );
  await user.click(compare);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Not found",
  );
  expect(container.querySelector(".revision-compare")).toBeNull();
  expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
});

it("removes loaded text when history refresh after restore fails", async () => {
  let listReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return json({ data: { id: "p1", version: 3 } });
      return ++listReads === 1
        ? json({ data: [first, second] })
        : json({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", { name: "Restore version 1" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringMatching(/history could not be refreshed/i),
  );
  expect(
    screen.queryByRole("button", { name: "Restore version 1" }),
  ).toBeNull();
  expect(screen.queryByText("Old body")).toBeNull();
});

it("ignores a superseded history response after access is lost", async () => {
  const earlier = deferredResponse();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++reads === 1
        ? earlier.promise
        : json({ error: { code: "not_found", message: "Not found" } }, 404),
    ),
  );
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Not found",
  );
  await act(async () => earlier.resolve(json({ data: [first, second] })));
  expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
  expect(screen.queryByText("Old body")).toBeNull();
});

it("ignores a superseded comparison response after access is lost", async () => {
  const earlier = deferredResponse();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("compare")
        ? earlier.promise
        : ++reads === 1
          ? json({ data: [first, second] })
          : json({ error: { code: "not_found", message: "Not found" } }, 404),
    ),
  );
  const user = userEvent.setup();
  const { container } = render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore={false}
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", { name: "Compare versions" }),
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Not found",
  );
  await act(async () =>
    earlier.resolve(json({ data: { left: first, right: second } })),
  );
  expect(container.querySelector(".revision-compare")).toBeNull();
  expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
});

it("ignores a superseded post-restore history response", async () => {
  const earlier = deferredResponse();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return json({ data: { id: "p1", version: 3 } });
      ++reads;
      if (reads === 1) return json({ data: [first, second] });
      if (reads === 2) return earlier.promise;
      return json({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  render(
    <RevisionHistory
      kind="post"
      resourceId="p1"
      version={2}
      canRestore
      csrfToken="csrf"
      onRefresh={async () => 2}
      onRestored={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", { name: "Restore version 1" }),
  );
  await waitFor(() => expect(reads).toBe(2));
  await user.click(screen.getByRole("button", { name: "History" }));
  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Not found",
  );
  await act(async () => earlier.resolve(json({ data: [first, second] })));
  expect(
    screen.queryByRole("button", { name: "Restore version 1" }),
  ).toBeNull();
  expect(screen.queryByText("Old body")).toBeNull();
});
