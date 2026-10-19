import request from "supertest";
import express from "express";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadEnvironment } from "../config/environment.js";
import {
  createObservability,
  createWorkerMetricsApp,
  logApiEvent,
  observeBackgroundOperation,
} from "../observability/index.js";

const instances: Array<ReturnType<typeof createObservability>> = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.close()));
});

function fixture() {
  const events: string[] = [];
  const observability = createObservability({
    token: "test-operator-token-long-enough!",
    stdout: (line) => events.push(line),
  });
  instances.push(observability);
  return {
    app: createApp({
      environment: loadEnvironment({
        AUTH_TOKEN_SECRET:
          "unit-test-auth-secret-more-than-thirty-two-characters",
      }),
      observability,
    }),
    events,
  };
}

describe("API observability", () => {
  it("logs a sanitized unexpected API error when observability is disabled", () => {
    const appUrl = new URL("./app.ts", import.meta.url).href;
    const environmentUrl = new URL("../config/environment.ts", import.meta.url)
      .href;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import request from "supertest";
         import { createApp } from ${JSON.stringify(appUrl)};
         import { loadEnvironment } from ${JSON.stringify(environmentUrl)};
         const environment = loadEnvironment({ AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters" });
         const authService = { requestVerificationIdempotently: async () => { throw new Error("private-secret"); } };
         const response = await request(createApp({ environment, authService }))
           .post("/api/v1/account-verification-requests")
           .set("Origin", environment.frontendBaseUrl)
           .send({ email: "ada@example.edu" });
         process.stdout.write(JSON.stringify({ status: response.status, body: response.body }) + "\\n");`,
      ],
      { encoding: "utf8" },
    );
    const entries = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "unexpected_error",
        errorCode: "internal_error",
        level: 50,
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 500,
        body: expect.objectContaining({
          error: expect.objectContaining({ code: "internal_error" }),
        }),
      }),
    );
    expect(output).not.toContain("private-secret");
  });

  it("reports worker failures without leaking errors when observability is disabled", () => {
    const moduleUrl = new URL("../observability/index.ts", import.meta.url)
      .href;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { logUnexpectedError } from ${JSON.stringify(moduleUrl)}; logUnexpectedError(undefined, "job_worker_failure"); logUnexpectedError(undefined, "private-secret");`,
      ],
      { encoding: "utf8" },
    );
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({
        event: "unexpected_error",
        errorCode: "job_worker_failure",
        level: 50,
      }),
      expect.objectContaining({
        event: "unexpected_error",
        errorCode: "internal_error",
        level: 50,
      }),
    ]);
    expect(output).not.toContain("private-secret");
  });

  it("emits structured system events without raw errors or identifiers", () => {
    const { events } = fixture();
    const observability = instances.at(-1)!;
    logApiEvent(observability, "api_started");
    logApiEvent(observability, "database_pool_error");
    logApiEvent(observability, "post_view_write_failed");
    expect(events.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: "api_started", level: 30 }),
      expect.objectContaining({ event: "database_pool_error", level: 50 }),
      expect.objectContaining({ event: "post_view_write_failed", level: 50 }),
    ]);
  });

  it("emits a sanitized job start without a job ID or payload", () => {
    const { events } = fixture();
    instances.at(-1)!.recordJobStart("delete_course");
    expect(events.join("\n")).toContain('"event":"job_start"');
    expect(events.join("\n")).not.toContain("courseId");
  });

  it("serves only protected worker metrics on the private worker listener", async () => {
    const { events } = fixture();
    const workerMetrics = createWorkerMetricsApp(instances.at(-1)!);
    expect((await request(workerMetrics).get("/health")).status).toBe(404);
    expect((await request(workerMetrics).get("/metrics")).status).toBe(401);
    instances.at(-1)!.recordJob("delete_course_file", "succeeded", 0.01);
    const response = await request(workerMetrics)
      .get("/metrics")
      .set("Authorization", "Bearer test-operator-token-long-enough!");
    expect(response.status).toBe(200);
    expect(response.text).toContain('kind="delete_course_file"');
    expect(events.join("\n")).toContain('"kind":"delete_course_file"');
  });

  it("records digest scheduling and delivery outcomes without content", async () => {
    const { events } = fixture();
    const observability = instances.at(-1)!;
    expect(
      await observeBackgroundOperation(
        observability,
        "digest_schedule",
        async () => 2,
      ),
    ).toBe(2);
    expect(
      await observeBackgroundOperation(
        observability,
        "digest_schedule",
        async () => 0,
      ),
    ).toBe(0);
    await expect(
      observeBackgroundOperation(observability, "digest_delivery", async () => {
        throw new Error("private digest content");
      }),
    ).rejects.toThrow("private digest content");
    const metrics = await request(createWorkerMetricsApp(observability))
      .get("/metrics")
      .set("Authorization", "Bearer test-operator-token-long-enough!");
    expect(metrics.text).toContain(
      'chalktalk_jobs_total{kind="digest_schedule",outcome="succeeded"} 2',
    );
    expect(metrics.text).toContain('kind="digest_delivery",outcome="failed"');
    expect(events.join("\n")).not.toContain("private digest content");
  });

  it("does not register metrics in the ordinary API", async () => {
    expect((await request(createApp()).get("/metrics")).status).toBe(404);
  });

  it("allows only the configured bearer token to scrape and never uses raw URLs as labels", async () => {
    const { app } = fixture();
    await request(app).get("/api/v1/secret-123?email=private@example.edu");
    await request(app).get(
      "/api/v1/courses/private-course-id/posts?q=private-search",
    );
    expect((await request(app).get("/metrics")).status).toBe(401);
    expect(
      (await request(app).get("/metrics").set("Authorization", "Bearer wrong"))
        .status,
    ).toBe(401);
    const scrape = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer test-operator-token-long-enough!");
    expect(scrape.status).toBe(200);
    expect(scrape.text).toContain('route="_unmatched"');
    expect(scrape.text).toContain('route="/api/v1/courses/:courseId/posts"');
    expect(scrape.text).toContain('le="0.2"');
    expect(scrape.text).not.toMatch(
      /secret-123|private@example.edu|private-course-id|private-search/,
    );
  });

  it("records only approved post type and sort values, not search text", async () => {
    const { app, events } = fixture();
    await request(app).get(
      "/api/v1/courses/secret-id/posts?type=question&sort=newest&q=private+text",
    );
    const output = events.join("\n");
    expect(output).toContain('"postType":"question"');
    expect(output).toContain('"sort":"newest"');
    expect(output).not.toContain("private text");
  });

  it("records a bounded list result count without logging response content", async () => {
    const events: string[] = [];
    const observability = createObservability({
      token: "test-operator-token-long-enough!",
      stdout: (line) => events.push(line),
    });
    instances.push(observability);
    const app = express();
    app.use(observability.requestMiddleware);
    app.get("/api/v1/courses/:courseId/posts", (_request, response) => {
      response.locals.safeResultCount = 2;
      response.json({ data: [{ title: "private-title" }, { title: "other" }] });
    });
    await request(app).get("/api/v1/courses/private-course/posts");
    expect(events.join("\n")).toContain('"resultCount":2');
    expect(events.join("\n")).not.toMatch(/private-title|private-course/);
  });

  it("logs only sanitized request metadata even for sensitive payloads", async () => {
    const { app, events } = fixture();
    await request(app)
      .post("/api/v1/sessions?private=token")
      .set("Origin", "https://localhost:5173")
      .send({ email: "private@example.edu", password: "supersecretpassword" });
    const output = events.join("\n");
    expect(output).toContain('"event":"http_request"');
    expect(output).not.toMatch(
      /private@example.edu|supersecretpassword|private=token/,
    );
  });

  it("records aborted requests separately without logging the path or query", async () => {
    const events: string[] = [];
    const observability = createObservability({
      token: "test-operator-token-long-enough!",
      stdout: (line) => events.push(line),
    });
    instances.push(observability);
    const app = express();
    app.use(observability.requestMiddleware);
    app.get("/slow/:id", () => {});
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const controller = new AbortController();
      const pending = fetch(
        `http://127.0.0.1:${address.port}/slow/private-id?secret=hidden`,
        { signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await expect(pending).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const event = events.map(
        (line) => JSON.parse(line) as Record<string, unknown>,
      )[0];
      expect(event).toMatchObject({
        event: "http_request",
        route: "/slow/:id",
        outcome: "aborted",
      });
      expect(events.join("\n")).not.toMatch(/private-id|hidden/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses a bounded error code for malformed JSON and never logs the body", async () => {
    const { app, events } = fixture();
    const response = await request(app)
      .post("/api/v1/sessions")
      .set("Content-Type", "application/json")
      .send('{"password":"private-secret",');
    expect(response.status).toBe(400);
    expect(events.join("\n")).toContain('"errorCode":"invalid_request"');
    expect(events.join("\n")).not.toContain("private-secret");
  });
});
