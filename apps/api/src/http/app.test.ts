import request from "supertest";
import { describe, expect, it } from "vitest";
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
});
