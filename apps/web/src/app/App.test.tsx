import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const session = {
  id: "session_123",
  user: {
    id: "user_123",
    email: "ada@example.edu",
    displayName: "Ada Lovelace",
    createdAt: "2026-09-20T14:30:00Z",
    updatedAt: "2026-09-20T14:30:00Z",
    version: 1,
  },
  expiresAt: "2026-10-20T14:30:00Z",
  csrfToken: "csrf_token",
};

const course = {
  id: "course_123",
  organizationId: "organization_123",
  name: "Linear Algebra II",
  status: "active" as const,
  joinCode: null,
  createdAt: "2026-09-20T14:30:00Z",
  updatedAt: "2026-09-20T14:30:00Z",
  version: 1,
};

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function unauthenticatedResponse() {
  return jsonResponse(
    {
      error: {
        code: "authentication_required",
        message: "Authentication is required",
      },
    },
    401,
  );
}

function setPath(path: string) {
  window.history.replaceState(null, "", path);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPath("/");
});

describe("ChalkTalk auth entry", () => {
  it("keeps a shared course header while switching between discussion and settings", async () => {
    setPath(`/courses/${course.id}`);
    const member = {
      id: "membership_123",
      courseId: course.id,
      user: { id: session.user.id, displayName: session.user.displayName },
      role: "student",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/sessions/current"))
        return jsonResponse({ data: session });
      if (url.endsWith(`/courses/${course.id}`))
        return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
      if (url.endsWith(`/members/${session.user.id}`))
        return jsonResponse({ data: member });
      if (url.endsWith("/members"))
        return jsonResponse({
          data: [member],
          page: { nextCursor: null, hasMore: false },
        });
      return jsonResponse({
        data: [],
        page: { nextCursor: null, hasMore: false },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    const header = await screen.findByRole("heading", { name: course.name });
    await user.click(screen.getByRole("link", { name: "Course settings" }));
    expect(window.location.pathname).toBe(`/courses/${course.id}/settings`);
    expect(screen.getByRole("heading", { name: course.name })).toBe(header);
    expect(
      screen
        .getByRole("link", { name: "Course settings" })
        .getAttribute("aria-current"),
    ).toBe("page");
    await screen.findByRole("heading", { name: "Members" });
    await user.click(screen.getByRole("link", { name: "Discussion" }));
    expect(window.location.pathname).toBe(`/courses/${course.id}`);
    expect(screen.getByRole("heading", { name: course.name })).toBe(header);
    expect(
      screen
        .getByRole("link", { name: "Discussion" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/sessions/current"),
      ),
    ).toHaveLength(1);
  });
  it("keeps the draft and URL when Settings navigation is declined", async () => {
    setPath(`/courses/${course.id}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Create post" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Post title" }),
      "My draft",
    );
    await user.click(screen.getByRole("link", { name: "Course settings" }));
    expect(window.location.pathname).toBe(`/courses/${course.id}`);
    expect(screen.getByRole("textbox", { name: "Post title" })).toHaveProperty(
      "value",
      "My draft",
    );
    expect(confirm).toHaveBeenCalledWith("Discard your unsaved post draft?");
    confirm.mockRestore();
  });
  it("updates the active course view on browser Back and Forward", async () => {
    setPath(`/courses/${course.id}`);
    const member = {
      id: "m1",
      courseId: course.id,
      user: { id: session.user.id, displayName: "Ada" },
      role: "student",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        if (url.endsWith(`/members/${session.user.id}`))
          return jsonResponse({ data: member });
        if (url.endsWith("/members"))
          return jsonResponse({
            data: [member],
            page: { nextCursor: null, hasMore: false },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("link", { name: "Course settings" }),
    );
    await screen.findByRole("heading", { name: "Members" });
    await act(async () => {
      window.history.back();
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("link", { name: "Discussion" })
          .getAttribute("aria-current"),
      ).toBe("page"),
    );
    await act(async () => {
      window.history.forward();
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("link", { name: "Course settings" })
          .getAttribute("aria-current"),
      ).toBe("page"),
    );
  });
  it("does not discard a draft when browser Back is declined", async () => {
    setPath(`/courses/${course.id}/settings`);
    const member = {
      id: "m1",
      courseId: course.id,
      user: { id: session.user.id, displayName: "Ada" },
      role: "student",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        if (url.endsWith(`/members/${session.user.id}`))
          return jsonResponse({ data: member });
        if (url.endsWith("/members"))
          return jsonResponse({
            data: [member],
            page: { nextCursor: null, hasMore: false },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Discussion" }));
    await user.click(
      await screen.findByRole("button", { name: "Create post" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Post title" }),
      "Keep this",
    );
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(window.location.pathname).toBe(`/courses/${course.id}`);
    expect(screen.getByRole("textbox", { name: "Post title" })).toHaveProperty(
      "value",
      "Keep this",
    );
    confirm.mockRestore();
  });
  it("keeps the course frame visible while settings members load and can retry", async () => {
    setPath(`/courses/${course.id}/settings`);
    let fail = true;
    const member = {
      id: "m1",
      courseId: course.id,
      user: { id: session.user.id, displayName: "Ada" },
      role: "student",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        if (url.endsWith(`/members/${session.user.id}`)) {
          if (fail)
            return jsonResponse(
              {
                error: {
                  code: "unavailable",
                  message: "Membership unavailable",
                },
              },
              503,
            );
          return jsonResponse({ data: member });
        }
        if (url.endsWith("/members"))
          return jsonResponse({
            data: [member],
            page: { nextCursor: null, hasMore: false },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: course.name });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Membership unavailable",
    );
    expect(screen.getByRole("link", { name: "Discussion" })).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Members" });
  });
  it("keeps the shared header visible during a slow settings request", async () => {
    setPath(`/courses/${course.id}`);
    let resolveMembers: ((response: Response) => void) | undefined;
    const member = {
      id: "m1",
      courseId: course.id,
      user: { id: session.user.id, displayName: "Ada" },
      role: "student",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        if (url.endsWith(`/members/${session.user.id}`))
          return jsonResponse({ data: member });
        if (url.endsWith("/members"))
          return new Promise<Response>((resolve) => {
            resolveMembers = resolve;
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const header = await screen.findByRole("heading", { name: course.name });
    await user.click(screen.getByRole("link", { name: "Course settings" }));
    expect(screen.getByRole("heading", { name: course.name })).toBe(header);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Loading course settings",
    );
    await act(async () => {
      resolveMembers?.(
        jsonResponse({
          data: [member],
          page: { nextCursor: null, hasMore: false },
        }),
      );
    });
    await screen.findByRole("heading", { name: "Members" });
  });
  it("updates the shared heading immediately after renaming in Settings", async () => {
    setPath(`/courses/${course.id}/settings`);
    const member = {
      id: "m1",
      courseId: course.id,
      user: { id: session.user.id, displayName: "Ada" },
      role: "instructor",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    const renamed = { ...course, name: "Advanced Algebra", version: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`) && init?.method === "PATCH")
          return jsonResponse({ data: renamed }, 200, { ETag: '"v2"' });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course }, 200, { ETag: '"v1"' });
        if (url.endsWith(`/members/${session.user.id}`))
          return jsonResponse({ data: member });
        if (url.endsWith("/members"))
          return jsonResponse({
            data: [member],
            page: { nextCursor: null, hasMore: false },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Save name" });
    await user.clear(screen.getByRole("textbox", { name: "Course name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Course name" }),
      renamed.name,
    );
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByRole("heading", { name: renamed.name });
    await user.click(screen.getByRole("link", { name: "Discussion" }));
    expect(screen.getByRole("heading", { name: renamed.name })).toBeTruthy();
  });
  it("replaces the selected post query live without discarding the composer draft", async () => {
    setPath(`/courses/${course.id}/posts/p1?q=old`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions/current"))
          return jsonResponse({ data: session });
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: course });
        if (url.endsWith("/posts/p1"))
          return jsonResponse({
            data: {
              id: "p1",
              courseId: course.id,
              type: "question",
              deleted: false,
              title: "Selected post",
              bodyMarkdown: "Details",
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
            },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Create post" });
    await user.click(screen.getByRole("button", { name: "Create post" }));
    await user.type(
      screen.getByRole("textbox", { name: "Post title" }),
      "Unsent draft",
    );
    const search = screen.getByRole("searchbox", { name: "Search posts" });
    await user.clear(search);
    await user.type(search, "new");
    await waitFor(() => expect(window.location.search).toBe("?q=new"));
    expect(window.location.pathname).toBe(`/courses/${course.id}/posts/p1`);
    expect(screen.getByRole("textbox", { name: "Post title" })).toHaveProperty(
      "value",
      "Unsent draft",
    );
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("protects home while restoring the browser session", async () => {
    setPath("/home");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(unauthenticatedResponse()),
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    expect(window.location.pathname).toBe("/");
    expect(document.activeElement).toBe(screen.getByLabelText("Email address"));
  });

  it("signs in, renders live courses, and signs out with the session CSRF token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [course],
          page: { nextCursor: null, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.type(
      screen.getByLabelText("Password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("heading", { name: "Welcome back, Ada" });
    expect(screen.getByText("Linear Algebra II")).toBeTruthy();
    expect(screen.queryByText("Data Structures")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/current",
      expect.objectContaining({
        method: "DELETE",
        headers: { Accept: "application/json", "X-CSRF-Token": "csrf_token" },
      }),
    );
  });

  it("shows an empty course state and creates a course in the signed-in organization", async () => {
    const instructorCourse = { ...course, joinCode: "ABCDEFGH" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: session }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [], page: { nextCursor: null, hasMore: false } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: course.organizationId,
              name: "Example University",
              createdAt: course.createdAt,
              updatedAt: course.updatedAt,
              version: 1,
            },
          ],
          page: { nextCursor: null, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: instructorCourse }, 201, { ETag: '"v1"' }),
      )
      .mockImplementation(async (url: string) => {
        const member = {
          id: "membership_123",
          courseId: course.id,
          user: { id: session.user.id, displayName: session.user.displayName },
          role: "instructor",
          createdAt: course.createdAt,
          updatedAt: course.updatedAt,
          version: 1,
        };
        if (url.endsWith(`/courses/${course.id}`))
          return jsonResponse({ data: instructorCourse }, 200, {
            ETag: '"v1"',
          });
        if (url.endsWith(`/members/${session.user.id}`))
          return jsonResponse({ data: member }, 200, { ETag: '"v1"' });
        if (url.endsWith("/members"))
          return jsonResponse({
            data: [member],
            page: { nextCursor: null, hasMore: false },
          });
        return jsonResponse({
          data: [],
          page: { nextCursor: null, hasMore: false },
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("You have not joined a course yet.");
    await user.click(screen.getByRole("button", { name: "Create course" }));
    await user.type(screen.getByLabelText("Course name"), "Linear Algebra II");
    await user.click(
      screen.getAllByRole("button", { name: "Create course" })[1]!,
    );

    await screen.findByRole("heading", { name: "Linear Algebra II" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/v1/organizations/${course.organizationId}/courses`,
      expect.objectContaining({
        body: JSON.stringify({ name: "Linear Algebra II" }),
        headers: expect.objectContaining({
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
  });

  it("shows instructor controls and sends the detail ETag when deleting a course", async () => {
    setPath(`/courses/${course.id}/settings`);
    const instructorCourse = { ...course, joinCode: "ABCDEFGH" };
    const member = {
      id: "membership_123",
      courseId: course.id,
      user: { id: session.user.id, displayName: session.user.displayName },
      role: "instructor",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      version: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: session }))
      .mockResolvedValueOnce(
        jsonResponse({ data: instructorCourse }, 200, { ETag: '"v4"' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: member }, 200, { ETag: '"v1"' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [member],
          page: { nextCursor: null, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { data: { ...instructorCourse, status: "deleting" } },
          202,
          { ETag: '"v5"' },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("button", { name: "Delete course" });
    await user.click(screen.getByRole("button", { name: "Delete course" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "being deleted",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `/api/v1/courses/${course.id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": session.csrfToken,
          "If-Match": '"v4"',
        },
      }),
    );
  });

  it("requests verification then creates and signs in an account from an emailed token", async () => {
    setPath("/verify-email?token=verification-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: session.user }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByRole("heading", {
      name: "Create your ChalkTalk account",
    });
    expect(window.location.search).toBe("");
    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.type(
      screen.getByLabelText("New password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByRole("heading", { name: "Welcome back, Ada" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/users",
      expect.objectContaining({
        body: JSON.stringify({
          verificationToken: "verification-token",
          displayName: "Ada",
          password: "correct horse battery staple",
        }),
      }),
    );
  });

  it("requests a school-email verification link from the landing page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("link", { name: "Create an account" });
    await user.click(screen.getByRole("link", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.click(
      screen.getByRole("button", { name: "Send verification link" }),
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Check your inbox",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/account-verification-requests",
      expect.objectContaining({
        body: JSON.stringify({ email: "ada@example.edu" }),
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
  });

  it("keeps reset requests generic and returns a completed reset to sign in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("link", { name: "Forgot password?" });
    await user.click(screen.getByRole("link", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "If an account matches that email",
    );

    cleanup();
    setPath("/reset-password?token=reset-token");
    fetchMock
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<App />);
    await screen.findByRole("heading", { name: "Set a new password" });
    await user.type(
      screen.getByLabelText("New password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Password reset",
    );
    await user.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(
      await screen.findByRole("heading", {
        name: "Discuss the work that matters.",
      }),
    ).toBeTruthy();
  });

  it("surfaces API errors and prevents duplicate pending submissions", async () => {
    let rejectLogin: ((reason: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectLogin = reject;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.type(screen.getByLabelText("Password"), "incorrect password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      (screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Signing in…" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rejectLogin?.(new Error("Network unavailable"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Network unavailable",
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
