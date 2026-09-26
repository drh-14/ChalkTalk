import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createAccount,
  currentSession,
  login,
  logout,
  requestPasswordReset,
  requestVerification,
  resetPassword,
} from "./client.js";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("browser auth client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses documented relative request details and returns a session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: session }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      login("Ada@Example.edu", "correct horse battery staple"),
    ).resolves.toEqual(session);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sessions", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "Ada@Example.edu",
        password: "correct horse battery staple",
      }),
    });
  });

  it("sends the documented idempotency and CSRF headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "user_123" } }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await createAccount(
      {
        verificationToken: "verification",
        password: "correct horse battery staple",
        displayName: "Ada",
      },
      "create-key",
    );
    await logout("csrf_token");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/users",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "Idempotency-Key": "create-key" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/sessions/current",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json", "X-CSRF-Token": "csrf_token" },
      }),
    );
  });

  it("calls each public auth endpoint with its documented body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestVerification("ada@example.edu", "verify-key");
    await requestPasswordReset("ada@example.edu");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await resetPassword("reset-token", "correct horse battery staple");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: session }));
    await currentSession();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/account-verification-requests",
      expect.objectContaining({
        body: JSON.stringify({ email: "ada@example.edu" }),
        headers: expect.objectContaining({ "Idempotency-Key": "verify-key" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/password-reset-requests",
      expect.objectContaining({
        body: JSON.stringify({ email: "ada@example.edu" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/password-resets",
      expect.objectContaining({
        body: JSON.stringify({
          token: "reset-token",
          newPassword: "correct horse battery staple",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/v1/sessions/current", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("exposes documented API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "invalid_credentials",
              message: "Email or password is invalid",
              requestId: "request_123",
            },
          },
          401,
        ),
      ),
    );

    await expect(login("ada@example.edu", "wrong password")).rejects.toEqual(
      new ApiError(
        401,
        "invalid_credentials",
        "Email or password is invalid",
        "request_123",
      ),
    );
  });
});
