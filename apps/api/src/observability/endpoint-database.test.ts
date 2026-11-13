import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createObservability } from "./index.js";
import { createPool } from "../database/pool.js";
import { createApp } from "../http/app.js";
import { loadEnvironment } from "../config/environment.js";
import { createServer } from "node:http";
import {
  captureRequestDatabaseTiming,
  recordRequestDatabaseTiming,
} from "../database/request-timing.js";

const token = "endpoint-database-metrics-test-token-123456";

async function metrics(app: ReturnType<typeof express>): Promise<string> {
  return (
    await request(app).get("/metrics").set("Authorization", `Bearer ${token}`)
  ).text;
}

describe("endpoint database totals", () => {
  it("records zero-work totals for selected requests rejected during JSON parsing", async () => {
    const observability = createObservability({ token, stdout: () => {} });
    const app = createApp({
      observability,
      environment: loadEnvironment({
        AUTH_TOKEN_SECRET: "endpoint-test-auth-secret-more-than-32-characters",
      }),
    });
    try {
      for (const [method, path] of [
        ["post", "/api/v1/sessions"],
        ["post", "/api/v1/organizations/private-id/courses"],
        ["get", "/api/v1/users/me/notifications"],
        ["get", "/api/v1/users/me/notifications/unread-count"],
        ["get", "/api/v1/courses/private-id"],
      ] as const) {
        const client = request(app);
        const response = await client[method](path)
          .set("Content-Type", "application/json")
          .send("{");
        expect(response.status).toBe(400);
      }
      const body = await metrics(app);
      for (const operation of [
        "login",
        "course_create",
        "notifications_list",
        "notifications_unread_count",
      ]) {
        for (const kind of ["query", "pool_acquire"]) {
          expect(body).toContain(
            `chalktalk_request_db_${kind}_total_duration_seconds_count{operation="${operation}",outcome="completed"} 1`,
          );
          expect(body).toContain(
            `chalktalk_request_db_${kind}_total_duration_seconds_sum{operation="${operation}",outcome="completed"} 0`,
          );
        }
      }
      const completed = [
        ...body.matchAll(
          /^chalktalk_http_requests_total\{[^\n]*outcome="completed"[^\n]*\} (\d+)$/gm,
        ),
      ].reduce((total, match) => total + Number(match[1]), 0);
      expect(completed).toBe(5);
      expect(body).not.toContain('outcome="aborted"} 1');
      expect(body).not.toContain("private-id");
    } finally {
      await observability.close();
    }
  });

  it("starts timing before authorization for exactly the four selected routes", async () => {
    const observability = createObservability({ token, stdout: () => {} });
    const app = createApp({
      observability,
      environment: loadEnvironment({
        AUTH_TOKEN_SECRET: "endpoint-test-auth-secret-more-than-32-characters",
      }),
    });
    await request(app).post("/api/v1/sessions").send({});
    await request(app)
      .post("/api/v1/organizations/private-id/courses")
      .send({});
    await request(app).get("/api/v1/users/me/notifications");
    await request(app).get("/api/v1/users/me/notifications/unread-count");
    await request(app).get("/api/v1/courses/private-id");
    const body = await metrics(app);
    for (const operation of [
      "login",
      "course_create",
      "notifications_list",
      "notifications_unread_count",
    ]) {
      expect(body).toContain(
        `chalktalk_request_db_query_total_duration_seconds_count{operation="${operation}",outcome="completed"} 1`,
      );
      expect(body).toContain(
        `chalktalk_request_db_query_total_duration_seconds_sum{operation="${operation}",outcome="completed"} 0`,
      );
    }
    expect(body).not.toContain("private-id");
    await observability.close();
  });

  it("records completed requests including zero work and failed operation durations", async () => {
    const observability = createObservability({ token, stdout: () => {} });
    const app = express();
    app.get(
      "/login",
      observability.endpointRequestMiddleware("login"),
      async (_req, res) => {
        const context = captureRequestDatabaseTiming();
        expect(context).toBeDefined();
        await Promise.resolve();
        recordRequestDatabaseTiming(context, "query", 0.03);
        recordRequestDatabaseTiming(context, "query", 0.02);
        recordRequestDatabaseTiming(context, "acquire", 0.01);
        res.sendStatus(500);
      },
    );
    app.get(
      "/empty",
      observability.endpointRequestMiddleware("login"),
      (_req, res) => res.sendStatus(204),
    );
    app.get("/metrics", observability.metricsHandler);

    expect((await request(app).get("/login")).status).toBe(500);
    expect((await request(app).get("/empty")).status).toBe(204);
    const body = await metrics(app);
    expect(body).toContain(
      'chalktalk_request_db_query_total_duration_seconds_count{operation="login",outcome="completed"} 2',
    );
    expect(body).toContain(
      'chalktalk_request_db_query_total_duration_seconds_sum{operation="login",outcome="completed"} 0.05',
    );
    expect(body).toContain(
      'chalktalk_request_db_pool_acquire_total_duration_seconds_count{operation="login",outcome="completed"} 2',
    );
    expect(body).toContain(
      'chalktalk_request_db_pool_acquire_total_duration_seconds_sum{operation="login",outcome="completed"} 0.01',
    );
  });

  it("isolates concurrent requests and excludes work after response completion", async () => {
    const observability = createObservability({ token, stdout: () => {} });
    const app = express();
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    app.get("/metrics", observability.metricsHandler);
    app.get(
      "/:id",
      observability.endpointRequestMiddleware("notifications_list"),
      async (req, res) => {
        const context = captureRequestDatabaseTiming();
        if (req.params.id === "first") {
          markFirstEntered();
          await firstReady;
        }
        recordRequestDatabaseTiming(
          context,
          "query",
          req.params.id === "first" ? 0.2 : 0.1,
        );
        res.sendStatus(200);
        res.once("finish", () =>
          recordRequestDatabaseTiming(context, "query", 1),
        );
      },
    );
    const first = request(app)
      .get("/first")
      .then((result) => result);
    await firstEntered;
    const second = request(app).get("/second");
    expect((await second).status).toBe(200);
    releaseFirst();
    expect((await first).status).toBe(200);
    const body = await metrics(app);
    expect(body).toContain(
      'chalktalk_request_db_query_total_duration_seconds_count{operation="notifications_list",outcome="completed"} 2',
    );
    expect(body).toContain(
      'chalktalk_request_db_query_total_duration_seconds_sum{operation="notifications_list",outcome="completed"} 0.3',
    );
  });

  it("records an aborted request once and excludes later database work", async () => {
    const observability = createObservability({ token, stdout: () => {} });
    const app = express();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let lateWork: (() => void) | undefined;
    app.get("/abort", observability.endpointRequestMiddleware("login"), () => {
      const context = captureRequestDatabaseTiming();
      recordRequestDatabaseTiming(context, "query", 0.04);
      lateWork = () => recordRequestDatabaseTiming(context, "query", 1);
      entered();
    });
    app.get("/metrics", observability.metricsHandler);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing port");
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${address.port}/abort`, {
        signal: controller.signal,
      });
      await ready;
      controller.abort();
      await expect(pending).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      lateWork?.();
      const body = await metrics(app);
      expect(body).toContain(
        'chalktalk_request_db_query_total_duration_seconds_count{operation="login",outcome="aborted"} 1',
      );
      expect(body).toContain(
        'chalktalk_request_db_query_total_duration_seconds_sum{operation="login",outcome="aborted"} 0.04',
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await observability.close();
    }
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  "endpoint totals with PostgreSQL",
  () => {
    it("includes successful and failed pooled queries while preserving global metrics", async () => {
      const observability = createObservability({ token, stdout: () => {} });
      const pool = createPool(databaseUrl!, observability.databaseObserver);
      const app = express();
      app.get(
        "/database",
        observability.endpointRequestMiddleware("course_create"),
        async (_req, res) => {
          await pool.query("SELECT 1");
          await expect(
            pool.query("SELECT * FROM nonexistent_private_table"),
          ).rejects.toThrow();
          res.sendStatus(200);
        },
      );
      app.get("/metrics", observability.metricsHandler);
      try {
        expect((await request(app).get("/database")).status).toBe(200);
        const body = await metrics(app);
        expect(body).toContain(
          'chalktalk_db_query_duration_seconds_count{outcome="succeeded"} 1',
        );
        expect(body).toContain(
          'chalktalk_db_query_duration_seconds_count{outcome="failed"} 1',
        );
        expect(body).toContain(
          'chalktalk_request_db_query_total_duration_seconds_count{operation="course_create",outcome="completed"} 1',
        );
        expect(body).toContain(
          'chalktalk_request_db_pool_acquire_total_duration_seconds_count{operation="course_create",outcome="completed"} 1',
        );
        const total = Number(
          body.match(
            /chalktalk_request_db_query_total_duration_seconds_sum\{operation="course_create",outcome="completed"\} ([0-9.]+)/,
          )?.[1],
        );
        expect(total).toBeGreaterThan(0);
      } finally {
        await pool.end();
        await observability.close();
      }
    });
  },
);
