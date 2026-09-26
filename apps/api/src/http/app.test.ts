import request from "supertest";
import { describe, expect, it } from "vitest";
import { type AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "./app.js";

describe("GET /health", () => {
  it("returns the API health status", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("authentication boundary", () => {
  it("rejects a public authentication request from an unapproved origin", async () => {
    const response = await request(createApp())
      .post("/api/v1/sessions")
      .set("Origin", "https://unapproved.example")
      .send({
        email: "ada@example.edu",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("origin_not_allowed");
  });

  it("returns an invalid-request envelope with a request id for malformed JSON", async () => {
    const response = await request(createApp())
      .post("/api/v1/account-verification-requests")
      .set("Origin", "https://localhost:5173")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Request body is invalid",
        requestId: expect.any(String),
        details: [],
      },
    });
    expect(response.headers["x-request-id"]).toBe(
      response.body.error.requestId,
    );
  });

  it("returns a generic internal-error envelope for unexpected failures", async () => {
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      ALLOWED_SCHOOL_DOMAINS: "example.edu",
      FRONTEND_ORIGINS: "https://app.example.edu",
      FRONTEND_BASE_URL: "https://app.example.edu",
    });
    const brokenService = {
      getIdempotentResponse: async () => {
        throw new Error("database credentials: should never reach a client");
      },
    } as unknown as AuthService;

    const response = await request(
      createApp({ environment, authService: brokenService }),
    )
      .post("/api/v1/account-verification-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "ada@example.edu" });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
        requestId: expect.any(String),
        details: [],
      },
    });
    expect(response.text).not.toContain("database credentials");
    expect(response.headers["x-request-id"]).toBe(
      response.body.error.requestId,
    );
  });
});
