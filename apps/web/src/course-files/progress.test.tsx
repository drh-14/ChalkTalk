import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CourseResources } from "./views.js";
const item = {
  id: "notes",
  courseId: "course",
  kind: "upload",
  title: "Reading",
  fileId: "file",
  version: 1,
  textStatus: "pending",
  textProgress: { phase: "ocr", completedPages: 7, totalPages: 18 },
  createdAt: "2026-11-04T00:00:00Z",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("shows real OCR pages and updates only metadata while retaining a draft", async () => {
  vi.useFakeTimers();
  let checks = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("resource-sections"))
        return Response.json({ data: [], version: 1 });
      if (url.endsWith("/resources/notes")) {
        checks++;
        return Response.json({
          data: {
            ...item,
            textProgress: {
              phase: "saving",
              completedPages: null,
              totalPages: null,
            },
          },
        });
      }
      return Response.json({
        data: [item],
        version: 1,
        page: { hasMore: false, nextCursor: null },
      });
    }),
  );
  render(
    <CourseResources courseId="course" canUpload staff csrfToken="csrf" />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("OCR: 7 of 18 pages")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("max")).toBe("18");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(checks).toBe(1);
  expect(screen.getByText("Saving extracted text")).toBeTruthy();
});
it("completes progress after another edit bumps the version, keeping the draft and edit token", async () => {
  vi.useFakeTimers();
  let phase: "saving" | "ready" = "saving";
  const writes: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("resource-sections"))
        return Response.json({ data: [], version: 1 });
      if (
        url.endsWith("/resources/notes") &&
        init?.method &&
        init.method !== "GET"
      ) {
        writes.push(init);
        return Response.json({
          data: { ...item, title: "My draft", version: 3 },
        });
      }
      if (url.endsWith("/resources/notes"))
        return Response.json({
          data: {
            ...item,
            title: "Renamed",
            version: 2,
            textStatus: phase === "ready" ? "ready" : "pending",
            textProgress:
              phase === "ready"
                ? null
                : { phase: "saving", completedPages: null, totalPages: null },
          },
        });
      return Response.json({
        data: [item],
        version: 1,
        page: { hasMore: false, nextCursor: null },
      });
    }),
  );
  render(
    <CourseResources courseId="course" canUpload staff csrfToken="csrf" />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(async () => {
    screen.getByRole("button", { name: "Edit Reading" }).click();
  });
  const title = screen.getByDisplayValue("Reading") as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(title, "My draft");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText("Saving extracted text")).toBeTruthy();
  expect(screen.queryByText(/Automatic checks paused/)).toBeNull();
  phase = "ready";
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.queryByText("Saving extracted text")).toBeNull();
  expect(screen.queryByText("Renamed")).toBeNull();
  expect(screen.getByDisplayValue("My draft")).toBeTruthy();
  await act(async () => {
    screen.getByRole("button", { name: "Save resource" }).click();
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(new Headers(writes[0]?.headers).get("If-Match")).toBe('"v1"');
});
it("keeps student cards free of progress and background requests", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.includes("resource-sections")
        ? { data: [], version: 1 }
        : {
            data: [item],
            version: 1,
            page: { hasMore: false, nextCursor: null },
          },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <CourseResources
      courseId="course"
      canUpload={false}
      staff={false}
      csrfToken="csrf"
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(
    fetch.mock.calls.some(([url]) => url.endsWith("/resources/notes")),
  ).toBe(false);
});
