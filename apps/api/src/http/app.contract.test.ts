import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "./app.js";

const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});

const user = {
  id: "user_123",
  email: "ada@example.edu",
  displayName: "Ada Lovelace",
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  version: 1,
};

const authenticatedService = {
  session: async () => ({
    id: "session_123",
    user,
    expiresAt: "2026-10-25T00:00:00.000Z",
    csrfToken: "csrf-token",
  }),
  profile: async () => user,
} as unknown as AuthService;

describe("authenticated read CORS contract", () => {
  it.each(["/api/v1/sessions/current", "/api/v1/users/me"])(
    "returns credentialed CORS headers for %s",
    async (path) => {
      const response = await request(
        createApp({ environment, authService: authenticatedService }),
      )
        .get(path)
        .set("Origin", environment.frontendBaseUrl)
        .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session-credential`);

      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(
        environment.frontendBaseUrl,
      );
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      expect(response.headers.vary).toBe("Origin");
    },
  );

  it("does not require or reflect an origin on safe reads", async () => {
    const app = createApp({ environment, authService: authenticatedService });
    const withoutOrigin = await request(app)
      .get("/api/v1/sessions/current")
      .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session-credential`);
    const unallowedOrigin = await request(app)
      .get("/api/v1/sessions/current")
      .set("Origin", "https://unapproved.example.edu")
      .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session-credential`);

    for (const response of [withoutOrigin, unallowedOrigin]) {
      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(
        response.headers["access-control-allow-credentials"],
      ).toBeUndefined();
    }
  });
});

function sessionService() {
  let revoked = false;
  const mutations: string[] = [];
  const session = {
    id: "session_123",
    user,
    expiresAt: "2026-10-25T00:00:00.000Z",
    csrfToken: "csrf-token",
  };
  const requireSession = async (_credential: string, csrf?: string) => {
    if (revoked)
      throw new AuthError(
        401,
        "authentication_required",
        "Authentication is required",
      );
    if (csrf !== undefined && csrf !== session.csrfToken)
      throw new AuthError(
        403,
        "csrf_validation_failed",
        "CSRF token is invalid",
      );
    return session;
  };
  return {
    service: {
      checkLimit: async () => undefined,
      login: async () => ({ credential: "session-credential", session }),
      session: requireSession,
      profile: async () => user,
      logout: async () => {
        mutations.push("logout");
        revoked = true;
      },
      updateProfile: async () => {
        mutations.push("profile");
        return user;
      },
      changePassword: async () => {
        mutations.push("password");
      },
      deleteAccount: async () => {
        mutations.push("deletion");
      },
    } as unknown as AuthService,
    mutations,
  };
}

describe("session and browser-security HTTP contract", () => {
  it("sets the documented session cookie, returns a stable CSRF token, and revokes on logout", async () => {
    const { service } = sessionService();
    const app = createApp({ environment, authService: service });
    const login = await request(app)
      .post("/api/v1/sessions")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: user.email, password: "correct horse battery staple" });

    expect(login.status).toBe(201);
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(login.headers["set-cookie"]?.[0]).toBe(
      "__Host-chalktalk_session=session-credential; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax",
    );
    expect(login.body.data.csrfToken).toBe("csrf-token");

    const current = await request(app)
      .get("/api/v1/sessions/current")
      .set("Cookie", `${SESSION_COOKIE_NAME}=session-credential`);
    expect(current.status).toBe(200);
    expect(current.headers["cache-control"]).toBe("no-store");
    expect(current.body.data).toEqual(login.body.data);

    const loggedOut = await request(app)
      .delete("/api/v1/sessions/current")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=session-credential`)
      .set("X-CSRF-Token", "csrf-token");
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers["set-cookie"]?.[0]).toBe(
      "__Host-chalktalk_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
    );

    const repeat = await request(app)
      .delete("/api/v1/sessions/current")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=session-credential`)
      .set("X-CSRF-Token", "csrf-token");
    expect(repeat.status).toBe(401);
    expect(repeat.body.error.code).toBe("authentication_required");
  });

  it("distinguishes origin rejection from CSRF rejection and never mutates on rejection", async () => {
    const { service, mutations } = sessionService();
    const app = createApp({ environment, authService: service });
    const paths = [
      { method: "delete", path: "/api/v1/sessions/current", body: undefined },
      {
        method: "patch",
        path: "/api/v1/users/me",
        body: { displayName: "Updated Ada" },
      },
      {
        method: "patch",
        path: "/api/v1/users/me/password",
        body: {
          currentPassword: "correct horse battery staple",
          newPassword: "a newer correct horse battery staple",
        },
      },
      {
        method: "delete",
        path: "/api/v1/users/me",
        body: { currentPassword: "correct horse battery staple" },
      },
    ] as const;
    const routeRequest = (method: "patch" | "delete", path: string) =>
      method === "patch" ? request(app).patch(path) : request(app).delete(path);

    for (const { method, path, body } of paths) {
      for (const origin of [
        undefined,
        "null",
        "https://unapproved.example.edu",
      ]) {
        const rejectedOrigin = routeRequest(method, path)
          .set("Cookie", `${SESSION_COOKIE_NAME}=session-credential`)
          .set("X-CSRF-Token", "csrf-token")
          .set("If-Match", '"v1"');
        if (origin) rejectedOrigin.set("Origin", origin);
        if (body) rejectedOrigin.send(body);
        const rejected = await rejectedOrigin;
        expect(rejected.status).toBe(403);
        expect(rejected.body.error.code).toBe("origin_not_allowed");
      }

      const withoutCsrf = routeRequest(method, path)
        .set("Origin", environment.frontendBaseUrl)
        .set("Cookie", `${SESSION_COOKIE_NAME}=session-credential`)
        .set("If-Match", '"v1"');
      if (body) withoutCsrf.send(body);
      const missingCsrf = await withoutCsrf;
      expect(missingCsrf.status).toBe(403);
      expect(missingCsrf.body.error.code).toBe("csrf_validation_failed");
    }
    expect(mutations).toEqual([]);
  });

  it("returns credentialed preflight headers only for an exact allowed origin", async () => {
    const allowed = await request(createApp({ environment }))
      .options("/api/v1/users/me")
      .set("Origin", environment.frontendBaseUrl);
    const unallowed = await request(createApp({ environment }))
      .options("/api/v1/users/me")
      .set("Origin", "https://unapproved.example.edu");

    expect(allowed.status).toBe(204);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": environment.frontendBaseUrl,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        "Content-Type,If-Match,Idempotency-Key,X-CSRF-Token",
      vary: "Origin",
    });
    expect(unallowed.status).toBe(403);
  });
});
