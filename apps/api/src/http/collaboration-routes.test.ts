import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";
import type { AuthService } from "../auth/service.js";
import { AuthError } from "../auth/errors.js";
import type { CollaborationStore } from "../collaboration/store.js";
import { createApp } from "./app.js";

const answerId = "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08";
const followupId = "01a0e5cc-58ae-7009-9f43-e237164911eb";
const userId = "01a0e5cc-58ae-7009-9f43-c8155fb23e05";
const sessionId = "01a0e5cc-58ae-7009-9f43-100000000001";

function app() {
  const session = vi
    .fn()
    .mockResolvedValue({ id: sessionId, user: { id: userId } });
  const issueTicket = vi.fn().mockResolvedValue("opaque-ticket");
  return {
    session,
    issueTicket,
    instance: createApp({
      environment: {
        databaseUrl: undefined,
        port: 3000,
        frontendOrigins: new Set(["https://localhost:5173"]),
        frontendBaseUrl: "https://localhost:5173",
        authTokenSecret: "a-secret-that-is-longer-than-thirty-two-characters",
        allowedSchoolDomains: new Set(["example.edu"]),
        rateLimits: {
          verificationPerEmail: 5,
          verificationPerIp: 100,
          loginPerEmail: 10,
          loginPerIp: 100,
          resetPerEmail: 5,
          resetPerIp: 100,
          signupPerIp: 100,
        },
        smtp: {
          host: "localhost",
          port: 1025,
          secure: false,
          user: undefined,
          password: undefined,
          from: "test@example.edu",
        },
      },
      authService: { session } as unknown as AuthService,
      collaborationStore: { issueTicket } as unknown as CollaborationStore,
    }),
  };
}

describe("collaboration ticket routes", () => {
  it.each([
    ["answer", answerId, "/api/v1/answers/"],
    ["followup", followupId, "/api/v1/followups/"],
  ] as const)(
    "issues a %s ticket through the authenticated unsafe boundary",
    async (kind, id, prefix) => {
      const fixture = app();
      const response = await request(fixture.instance)
        .post(`${prefix}${id}/collaboration-ticket`)
        .set("Origin", "https://localhost:5173")
        .set("Cookie", `${SESSION_COOKIE_NAME}=session`)
        .set("X-CSRF-Token", "csrf")
        .send({});
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        data: {
          ticket: "opaque-ticket",
          documentName: `${kind}:${id}`,
          expiresInSeconds: 300,
        },
      });
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(fixture.issueTicket).toHaveBeenCalledWith(
        kind,
        id,
        userId,
        sessionId,
      );
    },
  );

  it("rejects missing CSRF without issuing a ticket", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post(`/api/v1/answers/${answerId}/collaboration-ticket`)
      .set("Origin", "https://localhost:5173")
      .set("Cookie", `${SESSION_COOKIE_NAME}=session`)
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("csrf_validation_failed");
    expect(fixture.issueTicket).not.toHaveBeenCalled();
  });

  it("does not issue a ticket without an active session", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post(`/api/v1/answers/${answerId}/collaboration-ticket`)
      .set("Origin", "https://localhost:5173")
      .set("X-CSRF-Token", "csrf")
      .send({});
    expect(response.status).toBe(401);
    expect(fixture.issueTicket).not.toHaveBeenCalled();
  });

  it("preserves the role-based denial response without leaking a ticket", async () => {
    const fixture = app();
    fixture.issueTicket.mockRejectedValueOnce(
      new AuthError(403, "permission_denied", "Role cannot edit this answer"),
    );
    const response = await request(fixture.instance)
      .post(`/api/v1/answers/${answerId}/collaboration-ticket`)
      .set("Origin", "https://localhost:5173")
      .set("Cookie", `${SESSION_COOKIE_NAME}=session`)
      .set("X-CSRF-Token", "csrf")
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("permission_denied");
    expect(response.body.data).toBeUndefined();
  });
});
