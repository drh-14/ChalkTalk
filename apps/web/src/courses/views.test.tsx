import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseDetail, CourseHome } from "./views.js";

const csrfToken = "csrf-token";
const course = {
  id: "course_123",
  organizationId: "organization_123",
  name: "Linear Algebra",
  status: "active" as const,
  joinCode: null,
  createdAt: "2026-09-26T14:30:00Z",
  updatedAt: "2026-09-26T14:30:00Z",
  version: 1,
};
const instructor = {
  id: "membership_instructor",
  courseId: course.id,
  user: { id: "user_123", displayName: "Ada Lovelace" },
  role: "instructor" as const,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
  version: 1,
};
const student = {
  ...instructor,
  id: "membership_student",
  user: { id: "user_456", displayName: "Grace Hopper" },
  role: "student" as const,
};

function response(body: unknown, status = 200, etag?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { ETag: etag } : {}),
    },
  });
}

function page(data: unknown[]) {
  return response({ data, page: { nextCursor: null, hasMore: false } });
}

function nextPage(data: unknown[], cursor: string) {
  return response({ data, page: { nextCursor: cursor, hasMore: true } });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("course browser workflows", () => {
  it("shows a recoverable error when the live course list cannot load", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(page([]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CourseHome csrfToken={csrfToken} onOpenCourse={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Network unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("You have not joined a course yet.");
  });

  it("recovers from a failed later course page without duplicating earlier rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(nextPage([course], "course-next"))
      .mockRejectedValueOnce(new Error("Later page unavailable"))
      .mockResolvedValueOnce(
        page([{ ...course, id: "course_456", name: "Calculus" }]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CourseHome csrfToken={csrfToken} onOpenCourse={vi.fn()} />);
    await screen.findByText("Linear Algebra");
    await user.click(screen.getByRole("button", { name: "Load more courses" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Later page unavailable",
    );
    await user.click(
      screen.getByRole("button", { name: "Retry loading courses" }),
    );
    await screen.findByText("Calculus");
    expect(screen.getAllByText("Linear Algebra")).toHaveLength(1);
  });

  it("uses direct membership for instructor access and pages a roster independently", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(nextPage([student], "member-next"))
      .mockResolvedValueOnce(page([instructor]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByRole("button", { name: "Archive course" });
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("1 shown")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load more members" }));
    await screen.findByText("Ada Lovelace");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/courses/${course.id}/members?cursor=member-next`,
      { credentials: "include", headers: { Accept: "application/json" } },
    );
  });

  it("keeps a partial roster visible and retries a failed later member page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(nextPage([student], "member-retry"))
      .mockRejectedValueOnce(new Error("Roster page unavailable"))
      .mockResolvedValueOnce(page([instructor]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByText("Grace Hopper");
    await user.click(screen.getByRole("button", { name: "Load more members" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Roster page unavailable",
    );
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Retry loading members" }),
    );
    await screen.findByText("Ada Lovelace");
    expect(screen.getAllByText("Grace Hopper")).toHaveLength(1);
  });

  it("joins a course from the empty state with its code and CSRF credential", async () => {
    const opened = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(response({ data: student }, 201, '"v1"'));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CourseHome csrfToken={csrfToken} onOpenCourse={opened} />);
    await screen.findByText("You have not joined a course yet.");
    await user.click(screen.getByRole("button", { name: "Join a course" }));
    await user.type(screen.getByLabelText("Course link ID"), course.id);
    await user.type(screen.getByLabelText("Join code"), "abcdefgh");
    await user.click(screen.getByRole("button", { name: "Join course" }));

    expect(opened).toHaveBeenCalledWith(course.id);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/courses/${course.id}/members`,
      expect.objectContaining({
        body: JSON.stringify({ joinCode: "ABCDEFGH" }),
        headers: expect.objectContaining({ "X-CSRF-Token": csrfToken }),
      }),
    );
  });

  it("lets a student leave a course", async () => {
    const back = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(page([student]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={back}
        userId={student.user.id}
      />,
    );
    await screen.findByRole("button", { name: "Leave course" });
    await user.click(screen.getByRole("button", { name: "Leave course" }));

    expect(back).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/courses/${course.id}/members/me`,
      expect.objectContaining({
        method: "DELETE",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
      }),
    );
  });

  it("refreshes a stale instructor action and offers a retry", async () => {
    const stale = response(
      { error: { code: "version_conflict", message: "Course changed" } },
      412,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(
        response({ data: { ...course, version: 2 } }, 200, '"v2"'),
      )
      .mockResolvedValueOnce(
        response({ data: { ...instructor, version: 2 } }, 200, '"v2"'),
      )
      .mockResolvedValueOnce(page([{ ...instructor, version: 2 }]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByRole("button", { name: "Archive course" });
    await user.click(screen.getByRole("button", { name: "Archive course" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "refreshed",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/v1/courses/${course.id}`,
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": '"v1"' }),
      }),
    );
  });

  it("polls a deleting course until the server completes its cleanup", async () => {
    const deletingCourse = {
      ...course,
      status: "deleting" as const,
      joinCode: "ABCDEFGH",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ data: { ...course, joinCode: "ABCDEFGH" } }, 200, '"v1"'),
      )
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(response({ data: deletingCourse }, 202, '"v2"'))
      .mockResolvedValueOnce(response({ data: deletingCourse }, 200, '"v2"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByRole("button", { name: "Delete course" });
    await user.click(screen.getByRole("button", { name: "Delete course" }));
    await screen.findByRole("status");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7), {
      timeout: 2_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `/api/v1/courses/${course.id}`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
  });
});
