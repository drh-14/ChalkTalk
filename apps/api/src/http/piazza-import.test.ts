import { access } from "node:fs/promises";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { piazzaFixture } from "../piazza-import/fixture.js";
import type { PiazzaImportService } from "../piazza-import/service.js";
import { createApp } from "./app.js";

const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const actor = {
  id: "actor-1",
  email: "owner@example.edu",
  displayName: "Owner",
};
const authService = {
  session: async (_credential: string, csrf?: string) => {
    if (csrf !== undefined && csrf !== "csrf-token")
      throw new Error("bad csrf");
    return { id: "session-1", user: actor, csrfToken: "csrf-token" };
  },
} as unknown as AuthService;
const path = "/api/v1/piazza-imports";
const upload = (app: ReturnType<typeof createApp>) =>
  request(app)
    .post(path)
    .set("Origin", environment.frontendBaseUrl)
    .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session`)
    .set("X-CSRF-Token", "csrf-token")
    .attach(
      "file",
      Buffer.from(JSON.stringify(piazzaFixture())),
      "course.json",
    );

it("imports exactly one file for the session owner, returns aggregate data and cleans up", async () => {
  let tempPath = "";
  const importFile = vi.fn(async (filePath: string, user: typeof actor) => {
    tempPath = filePath;
    expect(user).toEqual({ id: actor.id, email: actor.email });
    await access(filePath);
    return {
      courseId: "course-1",
      courseName: "CSE 416 Software Engineering",
      omittedPrivatePosts: 1,
      posts: { created: 3, updated: 0, skipped: 0 },
      answers: { created: 2, updated: 0, skipped: 0 },
      followups: { created: 3, updated: 0, skipped: 0 },
    };
  });
  const app = createApp({
    environment,
    authService,
    piazzaImportService: { importFile } as unknown as PiazzaImportService,
  });
  const response = await upload(app);
  expect(response.status).toBe(200);
  expect(response.headers.location).toBe("/api/v1/courses/course-1");
  expect(response.body.data).toMatchObject({
    courseId: "course-1",
    omittedPrivatePosts: 1,
  });
  expect(importFile).toHaveBeenCalledOnce();
  await expect(access(tempPath)).rejects.toThrow();
});

it("rejects unauthenticated and missing CSRF requests before reading uploads", async () => {
  const importFile = vi.fn();
  const app = createApp({
    environment,
    authService,
    piazzaImportService: { importFile } as unknown as PiazzaImportService,
  });
  const noSession = await request(app)
    .post(path)
    .set("Origin", environment.frontendBaseUrl)
    .attach("file", Buffer.from("{}"), "course.json");
  expect(noSession.status).toBe(401);
  const noCsrf = await request(app)
    .post(path)
    .set("Origin", environment.frontendBaseUrl)
    .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session`)
    .attach("file", Buffer.from("{}"), "course.json");
  expect(noCsrf.status).toBe(403);
  expect(importFile).not.toHaveBeenCalled();
});

it("rejects oversized JSON before calling the importer", async () => {
  const importFile = vi.fn();
  const app = createApp({
    environment,
    authService,
    piazzaImportService: { importFile } as unknown as PiazzaImportService,
  });
  const response = await request(app)
    .post(path)
    .set("Origin", environment.frontendBaseUrl)
    .set("Cookie", `${SESSION_COOKIE_NAME}=opaque-session`)
    .set("X-CSRF-Token", "csrf-token")
    .attach("file", Buffer.alloc(20 * 1024 * 1024 + 1), "course.json");
  expect(response.status).toBe(413);
  expect(importFile).not.toHaveBeenCalled();
});
