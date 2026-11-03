import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  allowAnonymousPosting: true,
  allowPrivatePosting: true,
  allowFollowupResolution: true,
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
  it("requires a named confirmation before removing another course member", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, student]))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
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
    const trigger = await screen.findByRole("button", { name: "Remove" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Remove member" });
    expect(within(dialog).getByText(/Grace Hopper/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove member" })).getByRole(
        "button",
        { name: "Remove member" },
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(9));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Members" }),
      ),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      `/api/v1/courses/${course.id}/members/${student.user.id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "If-Match": '"v1"' }),
      }),
    );
  });

  it("shows instructor policy switches and saves a conditional change", async () => {
    const changed = { ...course, allowAnonymousPosting: false, version: 2 };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith(`/courses/${course.id}/members/${instructor.user.id}`))
        return Promise.resolve(response({ data: instructor }, 200, '"v1"'));
      if (url.endsWith(`/courses/${course.id}/members`))
        return Promise.resolve(page([instructor]));
      if (init?.method === "PATCH")
        return Promise.resolve(response({ data: changed }, 200, '"v2"'));
      return Promise.resolve(response({ data: course }, 200, '"v1"'));
    });
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
    const anonymity = await screen.findByRole("checkbox", {
      name: "Allow anonymous posting",
    });
    expect((anonymity as HTMLInputElement).checked).toBe(true);
    await user.click(anonymity);
    await waitFor(() =>
      expect((anonymity as HTMLInputElement).checked).toBe(false),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/courses/${course.id}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"v1"' }),
        body: JSON.stringify({ allowAnonymousPosting: false }),
      }),
    );
  });
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
    expect(
      screen.queryByRole("combobox", { name: "Role for Ada Lovelace" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Role for Grace Hopper" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
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
    const dialog = screen.getByRole("dialog", { name: "Delete course" });
    expect(within(dialog).getByText(/Linear Algebra/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete course permanently" }),
    );
    await screen.findByRole("status");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7), {
      timeout: 2_000,
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Course details" }),
      ),
    );

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

  it("cancels course deletion without a request and keeps focus in the dialog", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
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
    const trigger = await screen.findByRole("button", {
      name: "Delete course",
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Delete course" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", {
      name: "Delete course permanently",
    });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(confirm);
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requires reconfirmation after a stale course deletion", async () => {
    const renamed = { ...course, name: "Advanced Linear Algebra", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Course changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: renamed }, 200, '"v2"'))
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
    const trigger = await screen.findByRole("button", {
      name: "Delete course",
    });
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete course permanently",
      }),
    );
    await screen.findByRole("button", { name: "Retry" });
    await screen.findByRole("heading", { name: "Advanced Linear Algebra" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Advanced Linear Algebra/),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("withholds stale-course retry and old-details confirmation until refresh completes", async () => {
    const renamed = { ...course, name: "Advanced Linear Algebra", version: 2 };
    let finishRefresh!: (value: Response) => void;
    const delayedRefresh = new Promise<Response>((resolve) => {
      finishRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Course changed" } },
          412,
        ),
      )
      .mockReturnValueOnce(delayedRefresh)
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
    await user.click(
      await screen.findByRole("button", { name: "Delete course" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete course permanently",
      }),
    );
    await screen.findByText(/Refreshing current details/);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Delete course",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    finishRefresh(response({ data: renamed }, 200, '"v2"'));
    await screen.findByRole("button", { name: "Retry" });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Advanced Linear Algebra/),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("keeps the course confirmation open after a network failure for an explicit retry", async () => {
    const deletingCourse = { ...course, status: "deleting" as const };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(response({ data: deletingCourse }, 202, '"v2"'));
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
    await user.click(
      await screen.findByRole("button", { name: "Delete course" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete course" });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete course permanently" }),
    );
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Network unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete course permanently" }),
    );
    await screen.findByText(/This course is being deleted/);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("uses refreshed member details when retrying stale removal", async () => {
    const renamedStudent = {
      ...student,
      user: { ...student.user, displayName: "Grace Murray Hopper" },
      version: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, student]))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Member changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, renamedStudent]))
      .mockResolvedValueOnce(response({ data: renamedStudent }, 200, '"v2"'));
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
    const trigger = await screen.findByRole("button", { name: "Remove" });
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove member",
      }),
    );
    await screen.findByText("Grace Murray Hopper");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Grace Murray Hopper/),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("reconfirms after a member leaves and rejoins at the same version", async () => {
    const changed = {
      ...student,
      user: { ...student.user, displayName: "Grace Murray Hopper" },
      version: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, student]))
      .mockResolvedValueOnce(
        response(
          { data: student },
          200,
          '"m:550e8400-e29b-41d4-a716-446655440000:v1"',
        ),
      )
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Member changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, changed]))
      .mockResolvedValueOnce(
        response(
          { data: changed },
          200,
          '"m:550e8400-e29b-41d4-a716-446655440001:v1"',
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
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
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Grace Hopper/),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove member",
      }),
    );
    await screen.findByRole("button", { name: "Retry" });
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `/api/v1/courses/${course.id}/members/${student.user.id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "If-Match": '"m:550e8400-e29b-41d4-a716-446655440000:v1"',
        }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Grace Murray Hopper/),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove member",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(13));
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      `/api/v1/courses/${course.id}/members/${student.user.id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "If-Match": '"m:550e8400-e29b-41d4-a716-446655440001:v1"',
        }),
      }),
    );
  });

  it("reconfirms a changed member found beyond the refreshed first roster page", async () => {
    const changed = {
      ...student,
      user: { ...student.user, displayName: "Grace Murray Hopper" },
      version: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(nextPage([instructor], "more-members"))
      .mockResolvedValueOnce(page([student]))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Member changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(response({ data: changed }, 200, '"v2"'));
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
    await user.click(
      await screen.findByRole("button", { name: "Load more members" }),
    );
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove member",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/Grace Murray Hopper/),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("does not offer member retry when the member is gone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor, student]))
      .mockResolvedValueOnce(response({ data: student }, 200, '"v1"'))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Member changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(
        response(
          { error: { code: "not_found", message: "Member not found" } },
          404,
        ),
      );
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
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove member",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "no longer in the course",
      ),
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("does not offer course retry when deletion already started elsewhere", async () => {
    const deleting = { ...course, status: "deleting" as const, version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(
        response(
          { error: { code: "version_conflict", message: "Course changed" } },
          412,
        ),
      )
      .mockResolvedValueOnce(response({ data: deleting }, 200, '"v2"'))
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
    await user.click(
      await screen.findByRole("button", { name: "Delete course" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete course permanently",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "already being deleted",
      ),
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("groups instructor settings into sections with a single role per member and a copyable join code", async () => {
    const withCode = { ...course, joinCode: "ABCDEFGH" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ data: withCode }, 200, '"v1"'))
        .mockResolvedValueOnce(response({ data: instructor }, 200, '"v1"'))
        .mockResolvedValueOnce(page([instructor, student])),
    );
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByRole("heading", { name: "Course details" });
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Course name" }) as HTMLInputElement)
        .value,
    ).toBe("Linear Algebra");
    expect(screen.getByText("ABCDEFGH")).toBeTruthy();
    const managed = screen.getByText("Grace Hopper").closest(".member-row")!;
    expect(managed.firstElementChild?.textContent).toBe("Grace Hopper");
    expect(
      screen.getByRole("combobox", { name: "Role for Grace Hopper" }),
    ).toBeTruthy();
    const self = screen.getByText("Ada Lovelace").closest(".member-row")!;
    expect(self.textContent).toBe("Ada LovelaceInstructor");
    await user.click(screen.getByRole("button", { name: "Copy join code" }));
    expect(writeText).toHaveBeenCalledWith("ABCDEFGH");
    expect((await screen.findByRole("status")).textContent).toBe("Copied");
  });

  it("saves one per-course email switch without changing the others", async () => {
    const own = {
      ...student,
      user: instructor.user,
      emailPreferences: {
        activityEmails: false,
        announcementEmails: true,
        digestEmails: true,
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
      .mockResolvedValueOnce(
        response(
          { data: own },
          200,
          '"m:550e8400-e29b-41d4-a716-446655440000:v1"',
        ),
      )
      .mockResolvedValueOnce(page([instructor]))
      .mockResolvedValueOnce(
        response(
          { data: { ...own.emailPreferences, digestEmails: false } },
          200,
          '"m:550e8400-e29b-41d4-a716-446655440000:v2"',
        ),
      )
      .mockResolvedValueOnce(
        response(
          {
            data: {
              ...own.emailPreferences,
              digestEmails: false,
              announcementEmails: false,
            },
          },
          200,
          '"m:550e8400-e29b-41d4-a716-446655440000:v3"',
        ),
      );
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
    const digest = await screen.findByRole("checkbox", {
      name: "Daily digest emails",
    });
    expect((digest as HTMLInputElement).checked).toBe(true);
    await user.click(digest);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/v1/courses/${course.id}/members/me/email-preferences`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ digestEmails: false }),
      }),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Announcement emails",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect((digest as HTMLInputElement).checked).toBe(false);
    await user.click(
      screen.getByRole("checkbox", { name: "Announcement emails" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `/api/v1/courses/${course.id}/members/me/email-preferences`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "If-Match": '"m:550e8400-e29b-41d4-a716-446655440000:v2"',
        }),
      }),
    );
  });

  it("shows students read-only details without a join code and offers leaving", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ data: course }, 200, '"v1"'))
        .mockResolvedValueOnce(
          response(
            { data: { ...student, user: instructor.user } },
            200,
            '"v1"',
          ),
        )
        .mockResolvedValueOnce(page([instructor])),
    );
    render(
      <CourseDetail
        courseId={course.id}
        csrfToken={csrfToken}
        onBack={vi.fn()}
        userId={instructor.user.id}
      />,
    );
    await screen.findByRole("heading", { name: "Course details" });
    expect(screen.queryByRole("textbox", { name: "Course name" })).toBeNull();
    expect(screen.queryByText("Join code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive course" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave course" })).toBeTruthy();
    expect(screen.getByText("Instructor")).toBeTruthy();
  });
});
