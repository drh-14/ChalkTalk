import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCourse,
  getCourse,
  listCourses,
  listMembers,
  updateMembership,
} from "./client.js";

const course = {
  id: "course_123",
  organizationId: "organization_123",
  name: "Linear Algebra",
  status: "active" as const,
  joinCode: "ABCDEFGH",
  createdAt: "2026-09-26T14:30:00Z",
  updatedAt: "2026-09-26T14:30:00Z",
  version: 1,
};

const membership = {
  id: "membership_123",
  courseId: course.id,
  user: { id: "user_456", displayName: "Grace Hopper" },
  role: "student" as const,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
  version: 1,
};

function jsonResponse(body: unknown, etag?: string, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { ETag: etag } : {}),
    },
  });
}

describe("browser course client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a course with the documented credential, CSRF, and idempotency headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: course }, '"v1"', 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCourse(
        course.organizationId,
        "Linear Algebra",
        "csrf-token",
        "create-course-key",
      ),
    ).resolves.toEqual({ data: course, etag: '"v1"' });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${course.organizationId}/courses`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Linear Algebra" }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
          "Idempotency-Key": "create-course-key",
        },
      }),
    );
  });

  it("returns ETags from reads and uses them in conditional membership changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: course }, '"v3"'))
      .mockResolvedValueOnce(jsonResponse({ data: membership }, '"v2"'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCourse(course.id)).resolves.toEqual({
      data: course,
      etag: '"v3"',
    });
    await updateMembership(
      course.id,
      membership.user.id,
      "ta",
      "csrf-token",
      '"v2"',
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/courses/${course.id}/members/${membership.user.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "ta" }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
          "If-Match": '"v2"',
        },
      }),
    );
  });

  it("parses cursor pages and sends the cursor when loading more courses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [course],
          page: { nextCursor: "next-page", hasMore: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [], page: { nextCursor: null, hasMore: false } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listCourses()).resolves.toEqual({
      data: [course],
      page: { nextCursor: "next-page", hasMore: true },
    });
    await listCourses("next-page");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/courses?cursor=next-page",
      { credentials: "include", headers: { Accept: "application/json" } },
    );
  });
  it("returns member pages and sends their opaque cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [membership],
          page: { nextCursor: "member-next", hasMore: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [], page: { nextCursor: null, hasMore: false } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(listMembers(course.id)).resolves.toEqual({
      data: [membership],
      page: { nextCursor: "member-next", hasMore: true },
    });
    await listMembers(course.id, "member-next");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/courses/${course.id}/members?cursor=member-next`,
      { credentials: "include", headers: { Accept: "application/json" } },
    );
  });
});
