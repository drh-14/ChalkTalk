import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { RequestHandler } from "express";
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import pino from "pino";
import { LogSpool, type LogSpoolOptions } from "./spool.js";

type SystemEvent =
  | "api_started"
  | "worker_started"
  | "worker_stopped"
  | "database_pool_error"
  | "post_view_write_failed"
  | "semantic_index_write_failed";
type JobKind =
  | "delete_course"
  | "delete_course_file"
  | "delete_content_attachment"
  | "send_question_duplicate_email"
  | "index_post"
  | "digest_schedule"
  | "digest_delivery";
const fallbackLogger = pino({ base: null });

export function logApiEvent(
  observability: Observability | undefined,
  event: SystemEvent,
): void {
  if (observability) observability.recordSystemEvent(event);
  else
    fallbackLogger[
      ["api_started", "worker_started", "worker_stopped"].includes(event)
        ? "info"
        : "error"
    ]({ event });
}

export function logUnexpectedError(
  observability: Observability | undefined,
  code: string,
): void {
  if (observability) observability.recordUnexpectedError(code);
  else
    fallbackLogger.error({
      event: "unexpected_error",
      errorCode: safeErrorCode(code),
    });
}

function safeErrorCode(code: string): string {
  return /^[a-z_]{1,40}$/.test(code) ? code : "internal_error";
}

export interface ObservabilityOptions {
  token: string;
  spool?: LogSpoolOptions;
  stdout?: (line: string) => void;
}

const safeMethods = new Set([
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
  "OPTIONS",
]);
function methodLabel(value: string): string {
  return safeMethods.has(value) ? value : "OTHER";
}
function routeLabel(value: unknown): string {
  if (typeof value !== "string" || value.length > 160) return "_unmatched";
  // Express route templates contain only these characters. Never promote a raw URL to a label.
  return /^\/[a-zA-Z0-9_/:*{}.-]*$/.test(value) ? value : "_unmatched";
}
function safeContent(
  request: Parameters<RequestHandler>[0],
  route: string,
): Record<string, string> {
  if (route !== "/api/v1/courses/:courseId/posts") return {};
  const source = request.method === "GET" ? request.query : request.body;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const values = source as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (values.type === "question" || values.type === "note")
    fields.postType = values.type;
  if (
    request.method === "GET" &&
    ["relevance", "newest", "oldest", "recent_activity"].includes(
      values.sort as string,
    )
  )
    fields.sort = values.sort as string;
  return fields;
}
function statusClass(status: number): string {
  return status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : "other";
}
function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const incoming = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return (
    incoming.length === expected.length && timingSafeEqual(incoming, expected)
  );
}

export function createObservability(options: ObservabilityOptions) {
  if (!options.token || options.token.length < 32)
    throw new Error("METRICS_TOKEN must be at least 32 characters");
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({
    name: "chalktalk_http_requests_total",
    help: "Completed and aborted API requests",
    labelNames: ["method", "route", "status_class", "outcome"] as const,
    registers: [registry],
  });
  const latency = new Histogram({
    name: "chalktalk_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_class", "outcome"] as const,
    buckets: [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8,
    ],
    registers: [registry],
  });
  const jobs = new Counter({
    name: "chalktalk_jobs_total",
    help: "Attempted background jobs",
    labelNames: ["kind", "outcome"] as const,
    registers: [registry],
  });
  const jobDuration = new Histogram({
    name: "chalktalk_job_duration_seconds",
    help: "Background job attempt duration in seconds",
    labelNames: ["kind", "outcome"] as const,
    buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });
  const spoolDrops = new Counter({
    name: "chalktalk_log_spool_dropped_events_total",
    help: "Log events discarded by the bounded spool",
    registers: [registry],
  });
  const spoolEvictions = new Counter({
    name: "chalktalk_log_spool_evicted_segments_total",
    help: "Spool segments evicted at capacity or age",
    registers: [registry],
  });
  const spoolCapacityEvictedEvents = new Counter({
    name: "chalktalk_log_spool_capacity_evicted_events_total",
    help: "Events removed from the spool at capacity; delivery status is unknown",
    registers: [registry],
  });
  const spoolErrors = new Counter({
    name: "chalktalk_log_spool_write_errors_total",
    help: "Spool I/O errors",
    registers: [registry],
  });
  const spool = options.spool
    ? new LogSpool(options.spool, {
        onDrop: (count) => spoolDrops.inc(count),
        onEvict: (reason, count) => {
          spoolEvictions.inc();
          if (reason === "capacity") spoolCapacityEvictedEvents.inc(count);
        },
        onError: () => spoolErrors.inc(),
      })
    : undefined;
  const logger = pino(
    {
      base: null,
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    {
      write: (line: string) => {
        try {
          (options.stdout ?? ((value: string) => process.stdout.write(value)))(
            line,
          );
        } catch {
          /* telemetry must not affect API */
        }
        spool?.append(line);
      },
    },
  );

  const requestMiddleware: RequestHandler = (request, response, next) => {
    if (request.path === "/health" || request.path === "/metrics")
      return next();
    const started = process.hrtime.bigint();
    let done = false;
    const record = (outcome: "completed" | "aborted") => {
      if (done) return;
      done = true;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = {
        method: methodLabel(request.method),
        route: routeLabel(request.route?.path),
        status_class:
          outcome === "aborted" ? "other" : statusClass(response.statusCode),
        outcome,
      };
      requests.inc(labels);
      latency.observe(labels, seconds);
      const code = response.locals.errorCode;
      const resultCount = response.locals.safeResultCount;
      logger.info({
        event: "http_request",
        requestId:
          typeof response.locals.requestId === "string"
            ? response.locals.requestId
            : undefined,
        method: labels.method,
        route: labels.route,
        status: outcome === "aborted" ? undefined : response.statusCode,
        durationSeconds: seconds,
        outcome,
        errorCode:
          typeof code === "string" && /^[a-z_]{1,40}$/.test(code)
            ? code
            : undefined,
        ...safeContent(request, labels.route),
        resultCount:
          labels.route === "/api/v1/courses/:courseId/posts" &&
          request.method === "GET" &&
          response.statusCode === 200 &&
          Number.isInteger(resultCount) &&
          resultCount >= 0 &&
          resultCount <= 100
            ? resultCount
            : undefined,
      });
    };
    response.once("finish", () => record("completed"));
    response.once("close", () => record("aborted"));
    next();
  };
  const metricsHandler: RequestHandler = (request, response) => {
    if (!authorized(request.header("authorization"), options.token)) {
      response.set("Cache-Control", "no-store").status(401).end();
      return;
    }
    void registry
      .metrics()
      .then((body) => {
        response
          .set("Content-Type", registry.contentType)
          .set("Cache-Control", "no-store")
          .send(body);
      })
      .catch(() => response.status(503).end());
  };
  return {
    requestMiddleware,
    metricsHandler,
    recordJobStart(kind: JobKind) {
      logger.info({ event: "job_start", kind });
    },
    recordJob(kind: JobKind, outcome: "succeeded" | "failed", seconds: number) {
      jobs.inc({ kind, outcome });
      jobDuration.observe({ kind, outcome }, seconds);
      logger.info({
        event: "job_outcome",
        kind,
        outcome,
        durationSeconds: seconds,
      });
    },
    recordUnexpectedError(code: string) {
      logger.error({
        event: "unexpected_error",
        errorCode: safeErrorCode(code),
      });
    },
    recordSystemEvent(event: SystemEvent) {
      logger[
        ["api_started", "worker_started", "worker_stopped"].includes(event)
          ? "info"
          : "error"
      ]({ event });
    },
    async close() {
      await spool?.close();
    },
  };
}

export type Observability = ReturnType<typeof createObservability>;

/** The worker has no application routes; only its private, authenticated scrape endpoint. */
export function createWorkerMetricsApp(observability: Observability) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/metrics", observability.metricsHandler);
  return app;
}

export async function observeBackgroundOperation<T>(
  observability: Observability | undefined,
  kind: JobKind,
  action: () => Promise<T>,
): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    const result = await action();
    observability?.recordJob(
      kind,
      "succeeded",
      Number(process.hrtime.bigint() - started) / 1e9,
    );
    return result;
  } catch (error) {
    observability?.recordJob(
      kind,
      "failed",
      Number(process.hrtime.bigint() - started) / 1e9,
    );
    throw error;
  }
}
