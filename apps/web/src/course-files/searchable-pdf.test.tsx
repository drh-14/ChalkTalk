import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchablePdf, type SearchablePdf } from "./client.js";
import { SearchablePdfView } from "./searchable-pdf.js";

vi.mock("./client.js", () => ({ searchablePdf: vi.fn() }));

const pending: SearchablePdf = {
  fileId: "file",
  status: "pending",
  pageCount: null,
  sizeBytes: null,
  viewUrl: null,
  downloadUrl: null,
};
const minutes = (n: number) => n * 60_000;
const mockedRequest = vi.mocked(searchablePdf);

beforeEach(() => {
  vi.useFakeTimers();
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue({ data: pending });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view = () =>
  render(
    <SearchablePdfView courseId="course" resourceId="notes" csrfToken="csrf" />,
  );

describe("searchable PDF polling", () => {
  it("stops polling when a copy never becomes ready and offers a manual check", async () => {
    view();
    await act(() => vi.advanceTimersByTimeAsync(minutes(17)));
    const polls = mockedRequest.mock.calls.length;
    expect(polls).toBeGreaterThan(1);
    // The server abandons a copy after 15 minutes, so a bounded number of
    // requests is enough; this guards against polling every two seconds forever.
    expect(polls).toBeLessThan(150);

    await act(() => vi.advanceTimersByTimeAsync(minutes(30)));
    expect(mockedRequest).toHaveBeenCalledTimes(polls);
    expect(screen.queryByText("Preparing searchable PDF…")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(
      /taking longer than expected/i,
    );
  });

  it("keeps polling quickly at first and resumes after Check again", async () => {
    view();
    await act(() => vi.advanceTimersByTimeAsync(7_000));
    expect(mockedRequest.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("status").textContent).toBe(
      "Preparing searchable PDF…",
    );

    await act(() => vi.advanceTimersByTimeAsync(minutes(17)));
    const stopped = mockedRequest.mock.calls.length;
    await act(async () => {
      screen.getByRole("button", { name: "Check again" }).click();
    });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mockedRequest.mock.calls.length).toBeGreaterThan(stopped);
    expect(screen.getByRole("status").textContent).toBe(
      "Preparing searchable PDF…",
    );
  });

  it("replaces the preparing status with the error when a poll fails", async () => {
    view();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("status").textContent).toBe(
      "Preparing searchable PDF…",
    );
    mockedRequest.mockRejectedValueOnce(new Error("Service unavailable"));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Service unavailable",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
