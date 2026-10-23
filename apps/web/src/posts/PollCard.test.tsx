import { cleanup, render, screen, within } from "@testing-library/react";
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
  vi.unstubAllGlobals();
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
