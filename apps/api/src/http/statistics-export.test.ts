import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { AuthError } from "../auth/errors.js";
import type { StatisticsService } from "../statistics/service.js";
import { createApp } from "./app.js";

const courseId = "019a0b68-3857-799a-8494-709330948d46";
const userId = "019a0b68-3857-799a-8494-709330948d47";
function app(role: "staff" | "student" = "staff", authenticated = true) {
  const statisticsService = {
    exportDaily: async () => {
      if (role === "student")
        throw new AuthError(403, "permission_denied", "Staff role is required");
      return "date,questions_created,answers_created,posts_viewed\r\n2026-10-21,1,0,0\r\n";
    },
    exportStudents: async () => {
      if (role === "student")
        throw new AuthError(403, "permission_denied", "Staff role is required");
      return "user_id,display_name,questions_created,answers_contributed,posts_viewed\r\n";
    },
  } as StatisticsService;
  const authService = {
    session: async () => {
      if (!authenticated)
        throw new AuthError(
          401,
          "authentication_required",
          "Authentication required",
        );
      return {
        id: userId,
        user: { id: userId },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
  } as AuthService;
  return createApp({
    authService,
    statisticsService,
    environment: {
      databaseUrl: undefined,
      port: 3000,
      frontendOrigins: new Set(["https://app.example.edu"]),
      frontendBaseUrl: "https://app.example.edu",
      authTokenSecret: "a-secret-that-is-longer-than-thirty-two-characters",
      allowedSchoolDomains: new Set(["example.edu"]),
      rateLimits: { verificationPerEmail: 5 },
    } as Parameters<typeof createApp>[0]["environment"],
  });
}
const get = (server: ReturnType<typeof app>, path: string) =>
  request(server).get(path).set("Cookie", "__Host-chalktalk_session=opaque");

describe("statistics CSV HTTP contract", () => {
  it("returns a private CSV attachment for staff", async () => {
    const response = await get(
      app(),
      `/api/v1/courses/${courseId}/statistics/export/daily?period=7d`,
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(
      /^text\/csv; charset=utf-8/,
    );
    expect(response.headers["content-disposition"]).toContain(
      `${courseId}-7d-daily.csv`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.text).toContain("2026-10-21,1,0,0");
  });
  it("rejects invalid periods and student access without CSV data", async () => {
    const invalid = await get(
      app(),
      `/api/v1/courses/${courseId}/statistics/export/students?period=bad`,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_request");
    const forbidden = await get(
      app("student"),
      `/api/v1/courses/${courseId}/statistics/export/students`,
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("permission_denied");
  });
  it("requires a session", async () => {
    const response = await get(
      app("staff", false),
      `/api/v1/courses/${courseId}/statistics/export/daily`,
    );
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("authentication_required");
  });
});
