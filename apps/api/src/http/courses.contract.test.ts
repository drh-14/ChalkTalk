import request from "supertest";
import { describe, expect, it } from "vitest";
import { type AuthService } from "../auth/service.js";
import { type CourseService } from "../courses/service.js";
import { AuthError } from "../auth/errors.js";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "./app.js";

const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.edu",
  displayName: "Ada",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};
const course = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  name: "CS 101",
  status: "active" as const,
  joinCode: "ABCDEFGH",
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  version: 1,
};
function app(courseOverrides: Partial<CourseService> = {}) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: "session",
        user,
        expiresAt: "2026-12-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    courseService: {
      organizations: async () => [
        {
          id: course.organizationId,
          name: "Example",
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          version: 1,
        },
      ],
      list: async () => [course],
      listPage: async () => ({
        data: [course],
        page: { nextCursor: null, hasMore: false },
      }),
      listOrganization: async () => [course],
      listOrganizationPage: async () => ({
        data: [course],
        page: { nextCursor: null, hasMore: false },
      }),
      create: async () => course,
      createIdempotently: async () => ({ value: course, status: 201 }),
      get: async () => course,
      join: async () => ({
        id: "membership",
        courseId: course.id,
        user: { id: user.id, displayName: user.displayName },
        role: "student" as const,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        version: 1,
      }),
      joinIdempotently: async () => ({
        value: {
          id: "membership",
          courseId: course.id,
          user: { id: user.id, displayName: user.displayName },
          role: "student" as const,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          version: 1,
        },
        status: 201,
      }),
      members: async () => [],
      getMember: async () => ({
        id: "membership",
        courseId: course.id,
        user: { id: user.id, displayName: user.displayName },
        role: "instructor" as const,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        version: 1,
      }),
      membersPage: async () => ({
        data: [],
        page: { nextCursor: null, hasMore: false },
      }),
      update: async () => course,
      delete: async () => ({ ...course, status: "deleting" as const }),
      updateMember: async () => {
        throw new Error("unused");
      },
      removeMember: async () => undefined,
      ...courseOverrides,
    } as unknown as CourseService,
  });
}
const cookie = "__Host-chalktalk_session=opaque";

describe("course HTTP contract", () => {
  it("lists the direct organization and authenticated courses", async () => {
    const organization = await request(app())
      .get("/api/v1/organizations")
      .set("Cookie", cookie);
    const courses = await request(app())
      .get("/api/v1/courses")
      .set("Cookie", cookie);
    expect(organization.status).toBe(200);
    expect(organization.body).toEqual({
      data: [
        {
          id: course.organizationId,
          name: "Example",
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          version: 1,
        },
      ],
      page: { nextCursor: null, hasMore: false },
    });
    expect(courses.status).toBe(200);
    expect(courses.body).toEqual({
      data: [
        Object.fromEntries(
          Object.entries(course).filter(([key]) => key !== "joinCode"),
        ),
      ],
      page: { nextCursor: null, hasMore: false },
    });
  });
  it("lists courses for the authenticated user's organization", async () => {
    const response = await request(app())
      .get(`/api/v1/organizations/${course.organizationId}/courses`)
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      Object.fromEntries(
        Object.entries(course).filter(([key]) => key !== "joinCode"),
      ),
    ]);
  });
  it("rejects an invalid list limit before querying courses", async () => {
    const response = await request(app())
      .get("/api/v1/courses?limit=101")
      .set("Cookie", cookie);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });
  it("forwards cursors to organization-course and membership page queries", async () => {
    const calls: Array<{ endpoint: string; cursor?: string }> = [];
    const testApp = app({
      listOrganizationPage: async (
        _organizationId,
        _userId,
        _status,
        _limit,
        cursor,
      ) => {
        calls.push({ endpoint: "organization", cursor });
        return { data: [course], page: { nextCursor: null, hasMore: false } };
      },
      membersPage: async (_courseId, _userId, _role, _limit, cursor) => {
        calls.push({ endpoint: "members", cursor });
        return { data: [], page: { nextCursor: null, hasMore: false } };
      },
    });
    await request(testApp)
      .get(
        `/api/v1/organizations/${course.organizationId}/courses?cursor=organization-page`,
      )
      .set("Cookie", cookie)
      .expect(200);
    await request(testApp)
      .get(`/api/v1/courses/${course.id}/members?cursor=member-page`)
      .set("Cookie", cookie)
      .expect(200);
    expect(calls).toEqual([
      { endpoint: "organization", cursor: "organization-page" },
      { endpoint: "members", cursor: "member-page" },
    ]);
  });
  it("keeps the direct organization listing to a single page", async () => {
    await request(app())
      .get("/api/v1/organizations?cursor=not-issued")
      .set("Cookie", cookie)
      .expect(400);
    const response = await request(app())
      .get("/api/v1/organizations?limit=0")
      .set("Cookie", cookie);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });
  it("creates a course only with the browser origin and CSRF credential", async () => {
    const response = await request(app())
      .post(`/api/v1/organizations/${course.organizationId}/courses`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .send({ name: "CS 101" });
    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/courses/${course.id}`);
    expect(response.headers.etag).toBe('"v1"');
    expect(response.body.data.joinCode).toBe("ABCDEFGH");
  });
  it("returns accepted while deletion is pending and rejects a duplicate deletion", async () => {
    let deletes = 0;
    const testApp = app({
      delete: async () => {
        deletes += 1;
        if (deletes > 1)
          throw new AuthError(
            409,
            "course_deleting",
            "Course deletion is already in progress",
          );
        return { ...course, status: "deleting" as const };
      },
    });
    const first = await request(testApp)
      .delete(`/api/v1/courses/${course.id}`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"');
    expect(first.status).toBe(202);
    expect(first.headers.location).toBe(`/api/v1/courses/${course.id}`);
    const second = await request(testApp)
      .delete(`/api/v1/courses/${course.id}`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("course_deleting");
  });
  it("serves the remaining course and membership operations with their documented headers", async () => {
    const membership = {
      id: "membership",
      courseId: course.id,
      user: { id: user.id, displayName: user.displayName },
      role: "student" as const,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      version: 2,
    };
    const calls: string[] = [];
    const testApp = app({
      get: async () => course,
      joinIdempotently: async () => ({ value: membership, status: 201 }),
      membersPage: async () => ({
        data: [membership],
        page: { nextCursor: null, hasMore: false },
      }),
      getMember: async () => membership,
      update: async () => ({ ...course, name: "CS 102", version: 2 }),
      updateMember: async () => ({
        ...membership,
        role: "ta" as const,
        version: 3,
      }),
      removeMember: async (
        _courseId,
        _actorId,
        _targetId,
        ifMatch,
        selfLeave,
      ) => {
        calls.push(`${ifMatch ?? "none"}:${selfLeave}`);
      },
    });
    const read = { Cookie: cookie };
    const unsafe = {
      ...read,
      Origin: environment.frontendBaseUrl,
      "X-CSRF-Token": "csrf",
    };

    await request(testApp)
      .get(`/api/v1/courses/${course.id}`)
      .set(read)
      .expect(200)
      .expect("ETag", '"v1"');
    await request(testApp)
      .post(`/api/v1/courses/${course.id}/members`)
      .set(unsafe)
      .send({ joinCode: "ABCDEFGH" })
      .expect(201)
      .expect("ETag", '"v2"');
    await request(testApp)
      .get(`/api/v1/courses/${course.id}/members?role=student`)
      .set(read)
      .expect(200);
    await request(testApp)
      .get(`/api/v1/courses/${course.id}/members/${user.id}`)
      .set(read)
      .expect(200)
      .expect("ETag", '"v2"');
    await request(testApp)
      .patch(`/api/v1/courses/${course.id}`)
      .set({ ...unsafe, "If-Match": '"v1"' })
      .send({ name: "CS 102" })
      .expect(200)
      .expect("ETag", '"v2"');
    await request(testApp)
      .patch(`/api/v1/courses/${course.id}/members/${user.id}`)
      .set({ ...unsafe, "If-Match": '"v2"' })
      .send({ role: "ta" })
      .expect(200)
      .expect("ETag", '"v3"');
    await request(testApp)
      .delete(`/api/v1/courses/${course.id}/members/${user.id}`)
      .set({ ...unsafe, "If-Match": '"v2"' })
      .expect(204);
    await request(testApp)
      .delete(`/api/v1/courses/${course.id}/members/me`)
      .set(unsafe)
      .expect(204);
    expect(calls).toEqual(['"v2":false', "none:true"]);
  });
  it("enforces authentication, CSRF, strict mutation bodies, and list filters", async () => {
    await request(app()).get("/api/v1/courses").expect(401);
    await request(app())
      .post(`/api/v1/organizations/${course.organizationId}/courses`)
      .set("Cookie", cookie)
      .send({ name: "CS 101" })
      .expect(403);
    await request(app())
      .post(`/api/v1/organizations/${course.organizationId}/courses`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .send({ name: "CS 101", unexpected: true })
      .expect(422);
    const unsupportedMedia = await request(app())
      .post(`/api/v1/organizations/${course.organizationId}/courses`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .set("Content-Type", "text/plain")
      .send('{"name":"CS 101"}');
    expect(unsupportedMedia.status).toBe(422);
    expect(unsupportedMedia.body.error.code).toBe("validation_failed");
    const hiddenCourse = await request(
      app({
        joinIdempotently: async () => {
          throw new AuthError(422, "invalid_join_code", "Join code is invalid");
        },
      }),
    )
      .post("/api/v1/courses/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/members")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .send({ joinCode: "ABCDEFGH" });
    expect(hiddenCourse.status).toBe(422);
    expect(hiddenCourse.body.error.code).toBe("invalid_join_code");
    await request(app())
      .patch(`/api/v1/courses/${course.id}/members/${user.id}`)
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"')
      .send({ role: "owner" })
      .expect(422);
    const filtered = await request(app())
      .get("/api/v1/courses?status=not-a-status")
      .set("Cookie", cookie);
    expect(filtered.status).toBe(400);
    expect(filtered.body.error.code).toBe("invalid_request");
  });
  it("does not let malformed resource IDs escape as database errors", async () => {
    await request(app())
      .get("/api/v1/courses/not-a-uuid")
      .set("Cookie", cookie)
      .expect(404);
    const join = await request(app())
      .post("/api/v1/courses/not-a-uuid/members")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "csrf")
      .send({ joinCode: "ABCDEFGH" });
    expect(join.status).toBe(422);
    expect(join.body.error.code).toBe("invalid_join_code");
  });
});
