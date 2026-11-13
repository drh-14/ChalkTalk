import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

export type EndpointOperation =
  | "login"
  | "course_create"
  | "notifications_list"
  | "notifications_unread_count";
export type RequestOutcome = "completed" | "aborted";

interface RequestDatabaseTiming {
  querySeconds: number;
  acquireSeconds: number;
  closed: boolean;
}

const current = new AsyncLocalStorage<RequestDatabaseTiming>();

export function captureRequestDatabaseTiming():
  RequestDatabaseTiming | undefined {
  return current.getStore();
}

export function recordRequestDatabaseTiming(
  timing: RequestDatabaseTiming | undefined,
  kind: "query" | "acquire",
  seconds: number,
): void {
  if (!timing || timing.closed || !Number.isFinite(seconds) || seconds < 0)
    return;
  if (kind === "query") timing.querySeconds += seconds;
  else timing.acquireSeconds += seconds;
}

export function endpointRequestMiddleware(
  operation: EndpointOperation,
  observe: (
    operation: EndpointOperation,
    outcome: RequestOutcome,
    timing: Readonly<
      Pick<RequestDatabaseTiming, "querySeconds" | "acquireSeconds">
    >,
  ) => void,
): RequestHandler {
  return (_request, response, next) => {
    const timing: RequestDatabaseTiming = {
      querySeconds: 0,
      acquireSeconds: 0,
      closed: false,
    };
    const finish = (outcome: RequestOutcome) => {
      if (timing.closed) return;
      timing.closed = true;
      try {
        observe(operation, outcome, timing);
      } catch {
        // Monitoring must not change an HTTP response.
      }
    };
    response.once("finish", () => finish("completed"));
    response.once("close", () => finish("aborted"));
    current.run(timing, next);
  };
}
