import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PollCard } from "./PollCard.js";

const options = [
  { id: "mon", label: "Monday", voteCount: 2, selected: false },
  { id: "tue", label: "Tuesday", voteCount: 1, selected: false },
];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  { releaseMode: "automatic", released: true },
  { releaseMode: "manual", released: false },
] as const)(
  "refreshes $releaseMode poll state at the deadline",
  async ({ releaseMode, released }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const closesAt = new Date(Date.now() + 1000).toISOString();
    const fetchMock = vi.fn(async () =>
      json({
        data: {
          id: "p-1",
          type: "poll",
          version: 2,
          options: [
            {
              id: "mon",
              label: "Monday",
              selected: false,
              ...(released ? { voteCount: 1 } : {}),
            },
            {
              id: "tue",
              label: "Tuesday",
              selected: false,
              ...(released ? { voteCount: 0 } : {}),
            },
          ],
          ...(released ? { totalVotes: 1, explanation: "Monday wins." } : {}),
          selectionMode: "single",
          maxSelections: 1,
          closesAt,
          closed: true,
          releaseMode,
          resultsReleased: released,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PollCard
        postId="p-1"
        options={[
          { id: "mon", label: "Monday", selected: false },
          { id: "tue", label: "Tuesday", selected: false },
        ]}
        closesAt={closesAt}
        releaseMode={releaseMode}
        resultsReleased={false}
        closed={false}
        csrfToken="csrf"
      />,
    );
    expect(screen.getByRole("button", { name: "Vote" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading").textContent).toContain("closed");
    expect(screen.queryByRole("button", { name: "Vote" })).toBeNull();
    if (released) {
      expect(screen.getByText("Monday wins.")).toBeTruthy();
      expect(screen.getByText("1 (100%)")).toBeTruthy();
    } else {
      expect(screen.getByText(/Results are not released/)).toBeTruthy();
      expect(screen.queryByText(/100%/)).toBeNull();
    }
  },
);

it("retries a server-open deadline without restarting for a new callback", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
  const closesAt = new Date(Date.now() + 1000).toISOString();
  const post = (closed: boolean) => ({
    id: "p-1",
    type: "poll",
    version: 1,
    closesAt,
    closed,
    releaseMode: "automatic",
    resultsReleased: closed,
    options: [
      {
        id: "mon",
        label: "Monday",
        selected: false,
        ...(closed ? { voteCount: 1 } : {}),
      },
      {
        id: "tue",
        label: "Tuesday",
        selected: false,
        ...(closed ? { voteCount: 0 } : {}),
      },
    ],
    ...(closed ? { totalVotes: 1, explanation: "Monday wins." } : {}),
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ data: post(false) }))
    .mockResolvedValueOnce(json({ data: post(true) }));
  vi.stubGlobal("fetch", fetchMock);
  const firstChange = vi.fn();
  const secondChange = vi.fn();
  const props = {
    postId: "p-1",
    options: [
      { id: "mon", label: "Monday", selected: false },
      { id: "tue", label: "Tuesday", selected: false },
    ],
    closesAt,
    closed: false,
    releaseMode: "automatic" as const,
    resultsReleased: false,
    csrfToken: "csrf",
  };
  const { rerender } = render(
    <PollCard {...props} onPostChange={firstChange} />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  rerender(<PollCard {...props} onPostChange={secondChange} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(firstChange).not.toHaveBeenCalled();
  expect(secondChange).toHaveBeenCalledOnce();
  expect(screen.getByText("Monday wins.")).toBeTruthy();
});

it("stops deadline refreshes after bounded server-open responses", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
  const closesAt = new Date(Date.now() + 1000).toISOString();
  const fetchMock = vi.fn(async () =>
    json({
      data: {
        id: "p-1",
        type: "poll",
        version: 1,
        closesAt,
        closed: false,
        releaseMode: "automatic",
        resultsReleased: false,
        options: [{ id: "mon", label: "Monday", selected: false }],
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PollCard
      postId="p-1"
      options={[{ id: "mon", label: "Monday", selected: false }]}
      closesAt={closesAt}
      closed={false}
      releaseMode="automatic"
      resultsReleased={false}
      csrfToken="csrf"
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(70_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(60);
  expect(screen.getByRole("alert").textContent).toContain(
    "Could not confirm the poll deadline",
  );
});

it("retries a transient deadline request failure before revealing server results", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
  const closesAt = new Date(Date.now() + 1000).toISOString();
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(
      json({
        data: {
          id: "p-1",
          type: "poll",
          version: 1,
          closesAt,
          closed: true,
          releaseMode: "automatic",
          resultsReleased: true,
          totalVotes: 1,
          options: [
            { id: "mon", label: "Monday", selected: false, voteCount: 1 },
          ],
        },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PollCard
      postId="p-1"
      options={[{ id: "mon", label: "Monday", selected: false }]}
      closesAt={closesAt}
      closed={false}
      releaseMode="automatic"
      resultsReleased={false}
      csrfToken="csrf"
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.getByText(/Results are not released/)).toBeTruthy();
  expect(screen.queryByText(/100%/)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("1 (100%)")).toBeTruthy();
});

it("votes, shows results with the viewer's choice, then changes and retracts", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        data: {
          postId: "p-1",
          options: [
            { ...options[0], voteCount: 2 },
            { ...options[1], voteCount: 2, selected: true },
          ],
          totalVotes: 4,
        },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(
    <PollCard
      postId="p-1"
      options={options}
      totalVotes={3}
      closed={false}
      csrfToken="csrf"
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe("Poll · 3 votes");
  const vote = screen.getByRole("button", {
    name: "Vote",
  }) as HTMLButtonElement;
  expect(vote.disabled).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "Tuesday" }));
  await userEvent.click(vote);
  const results = await screen.findByRole("list");
  const rows = within(results).getAllByRole("listitem");
  expect(rows[1]!.textContent).toContain("Tuesday · your vote");
  expect(rows[1]!.textContent).toContain("2 (50%)");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ totalVotes: 4 }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Retract vote" }));
  expect(await screen.findByRole("radio", { name: "Tuesday" })).toBeTruthy();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ totalVotes: 3 }),
  );
  expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "DELETE" });
});

it("opens on results for a voter and offers changing the vote", async () => {
  render(
    <PollCard
      postId="p-1"
      options={[options[0]!, { ...options[1]!, selected: true }]}
      totalVotes={3}
      closed={false}
      csrfToken="csrf"
    />,
  );
  expect(screen.getByText(/your vote/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Change vote" }));
  expect(
    (screen.getByRole("radio", { name: "Tuesday" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
});

it("shows results only when the poll is closed", () => {
  render(
    <PollCard
      postId="p-1"
      options={options}
      totalVotes={3}
      closed
      csrfToken="csrf"
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe(
    "Poll · 3 votes · closed",
  );
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getAllByRole("listitem")[0]!.textContent).toContain("2 (67%)");
});

it("keeps archived-course results readable without offering staff writes", () => {
  render(
    <PollCard
      postId="p-1"
      options={options}
      totalVotes={3}
      closed
      staff
      courseActive={false}
      csrfToken="csrf"
    />,
  );
  expect(screen.getAllByRole("listitem")[0]!.textContent).toContain("2 (67%)");
  expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Clone poll" })).toBeNull();
  expect(screen.getByRole("button", { name: "Export results" })).toBeTruthy();
});

it("keeps the choices and shows the error when voting fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json(
        {
          error: {
            code: "poll_closed",
            message: "The poll or course is closed",
          },
        },
        409,
      ),
    ),
  );
  render(
    <PollCard
      postId="p-1"
      options={options}
      totalVotes={3}
      closed={false}
      csrfToken="csrf"
    />,
  );
  await userEvent.click(screen.getByRole("radio", { name: "Monday" }));
  await userEvent.click(screen.getByRole("button", { name: "Vote" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The poll or course is closed",
  );
  expect(screen.getByRole("radio", { name: "Monday" })).toBeTruthy();
});

it("hides unreleased counts while letting a student select up to the maximum", async () => {
  const fetchMock = vi.fn(async () =>
    json({
      data: {
        postId: "p-1",
        selectionMode: "multiple",
        maxSelections: 2,
        closed: false,
        releaseMode: "manual",
        resultsReleased: false,
        options: [
          { id: "mon", label: "Monday", selected: true },
          { id: "tue", label: "Tuesday", selected: true },
          { id: "wed", label: "Wednesday", selected: false },
        ],
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PollCard
      postId="p-1"
      options={[
        { id: "mon", label: "Monday", selected: false },
        { id: "tue", label: "Tuesday", selected: false },
        { id: "wed", label: "Wednesday", selected: false },
      ]}
      selectionMode="multiple"
      maxSelections={2}
      resultsReleased={false}
      closed={false}
      csrfToken="csrf"
    />,
  );
  expect(screen.queryByText(/votes/)).toBeNull();
  expect(screen.getByText(/Results are not released/)).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: "Monday" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Tuesday" }));
  expect(
    (screen.getByRole("checkbox", { name: "Wednesday" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Vote" }));
  expect(
    JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    ),
  ).toEqual({ optionIds: ["mon", "tue"] });
  expect(screen.queryByText(/50%/)).toBeNull();
});

it("staff can close, release, export, and clone a poll with revision headers", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("poll-results.csv"))
      return new Response("Option,Count\n", { status: 200 });
    return json({
      data: {
        id: "p-1",
        version: 5,
        options,
        totalVotes: 3,
        closed: true,
        resultsReleased: url.endsWith("/release"),
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PollCard
      postId="p-1"
      options={options}
      totalVotes={3}
      closed={false}
      csrfToken="csrf"
      staff
      version={4}
      resultsReleased={false}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Close poll" }));
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/posts/p-1/close");
  expect(
    (
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .headers as Record<string, string>
    )["If-Match"],
  ).toBe('"v4"');
  expect(
    await screen.findByRole("button", { name: "Reopen poll" }),
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Release results" }),
  );
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/posts/p-1/release");
  await userEvent.click(screen.getByRole("button", { name: "Clone poll" }));
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/clone"))).toBe(
    true,
  );
});

it("shows locked poll totals without voting or retraction controls", () => {
  render(
    <PollCard
      postId="poll"
      options={[{ id: "one", label: "One", voteCount: 1, selected: true }]}
      totalVotes={1}
      closed={false}
      discussionLocked
      csrfToken="csrf"
    />,
  );
  expect(screen.getByText(/locked/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change vote" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retract vote" })).toBeNull();
});
