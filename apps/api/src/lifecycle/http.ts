import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response, NextFunction } from "express";
import type { Lifecycle } from "./runtime.js";

type Owner = {
  pending: number;
  terminal: boolean;
  release: () => void;
  released: boolean;
};
/** Explicit wrappers retain ownership across actual handler and parser settlement. */
export function createHttpOwnership(
  lifecycle: Lifecycle | undefined,
  origins: ReadonlySet<string>,
) {
  const owners = new WeakMap<Request, Owner>();
  function settled(owner: Owner) {
    if (!owner.released && owner.terminal && owner.pending === 0) {
      owner.released = true;
      owner.release();
    }
  }
  const admission: RequestHandler = (request, response, next) => {
    if (request.method === "GET" && request.path === "/health") {
      response.status(200).json({ status: "ok" });
      return;
    }
    if (request.method === "GET" && request.path === "/ready") {
      const ready = lifecycle?.ready ?? true;
      response
        .set("Cache-Control", "no-store")
        .status(ready ? 200 : 503)
        .json({ ready });
      return;
    }
    if (!lifecycle) {
      next();
      return;
    }
    const release = lifecycle.admit("handler");
    if (!release) {
      const origin = request.headers.origin;
      if (origin && origins.has(origin))
        response.set({
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          Vary: "Origin",
        });
      const requestId = response.locals.requestId ?? randomUUID();
      response
        .set({
          "Retry-After": "1",
          Connection: "close",
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        })
        .status(503)
        .json({
          error: {
            code: "service_unavailable",
            message: "Service is temporarily unavailable",
            requestId,
            details: [],
          },
        });
      return;
    }
    const owner: Owner = {
      pending: 0,
      terminal: false,
      release,
      released: false,
    };
    owners.set(request, owner);
    const terminal = () => {
      owner.terminal = true;
      settled(owner);
    };
    response.once("finish", terminal);
    response.once("close", terminal);
    next();
  };
  function handler(
    callback: (
      request: Request,
      response: Response,
      next: NextFunction,
    ) => unknown,
  ): RequestHandler {
    return (request, response, next) => {
      const owner = owners.get(request);
      if (owner?.released || response.destroyed) return;
      if (owner) owner.pending++;
      let result: unknown;
      try {
        result = callback(request, response, next);
      } catch (error) {
        if (owner) {
          owner.pending--;
          settled(owner);
        }
        next(error);
        return;
      }
      return Promise.resolve(result)
        .catch(next)
        .finally(() => {
          if (owner) {
            owner.pending--;
            settled(owner);
          }
        });
    };
  }
  function parser(callback: RequestHandler): RequestHandler {
    return (request, response, next) => {
      const owner = owners.get(request);
      if (owner) owner.pending++;
      let done = false;
      const complete: NextFunction = (error?: unknown) => {
        if (done) return;
        done = true;
        // Enter downstream handlers before releasing parser ownership.
        try {
          next(error);
        } finally {
          if (owner) {
            owner.pending--;
            settled(owner);
          }
        }
      };
      try {
        callback(request, response, complete);
      } catch (error) {
        complete(error);
      }
    };
  }
  return { admission, handler, parser };
}
