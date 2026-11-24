import { performance } from "node:perf_hooks";
import type {
  DrainResult,
  FailureCode,
  LifecycleState,
  ShutdownTrigger,
  WorkKind,
} from "./types.js";

export const DEFAULT_DRAIN_DEADLINE_MS = 120_000;
type Phase = "transport" | "dependency" | "observability";
type Options = {
  deadlineMs?: number;
  publish: (result: DrainResult) => Promise<void>;
  exit?: (code: 0 | 1 | 2) => void;
};

/** Leases cover actual service settlement, never response/socket completion. */
export function createLifecycle(options: Options) {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
    throw new Error("Invalid drain deadline");
  const exit = options.exit ?? ((code) => process.exit(code));
  let state: LifecycleState = "STARTING";
  const stopAdmission = new AbortController();
  const forceCancel = new AbortController();
  const remaining: Record<WorkKind, number> = {
    startup: 0,
    handler: 0,
    admission: 0,
    store: 0,
    job: 0,
    heartbeat: 0,
    child: 0,
    listener: 0,
  };
  const failures = new Set<FailureCode>();
  const closers: Record<Phase, (() => Promise<void>)[]> = {
    transport: [],
    dependency: [],
    observability: [],
  };
  const cutoffHooks: (() => void)[] = [];
  let shutdownPromise: Promise<DrainResult> | undefined;
  let notifyIdle: (() => void) | undefined;
  let closed = false;
  let finished = false;
  const active = () => Object.values(remaining).some((count) => count !== 0);
  const fail = (code: FailureCode) => {
    failures.add(code);
    if (state !== "STOPPED") state = "FAILED";
  };
  const runtime = {
    get state() {
      return state;
    },
    get ready() {
      return state === "RUNNING";
    },
    stopAdmission: stopAdmission.signal,
    forceCancel: forceCancel.signal,
    markRunning() {
      if (state !== "STARTING") return false;
      state = "RUNNING";
      return true;
    },
    admit(kind: WorkKind): (() => void) | undefined {
      if (state !== "RUNNING" && !(state === "STARTING" && kind === "startup"))
        return undefined;
      remaining[kind]++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        remaining[kind]--;
        if (!active()) notifyIdle?.();
      };
    },
    fail,
    onCutoff(hook: () => void) {
      if (stopAdmission.signal.aborted)
        throw new Error("Admission already stopped");
      cutoffHooks.push(hook);
    },
    closeResource(phase: Phase, close: () => Promise<void>) {
      if (closed) throw new Error("Resource registered after owner settlement");
      closers[phase].push(close);
    },
    shutdown(trigger: ShutdownTrigger): Promise<DrainResult> {
      if (trigger === "fatal") fail("fatal");
      if (shutdownPromise) return shutdownPromise;
      const started = performance.now();
      const cutoffAt = new Date().toISOString();
      if (failures.size === 0) state = "DRAINING";
      // Assign before notifying cutoff observers, which may reenter shutdown.
      let resolve!: (result: DrainResult) => void;
      shutdownPromise = new Promise((done) => {
        resolve = done;
      });
      const snapshot = (timeout = false): DrainResult => ({
        trigger,
        result: timeout ? "timeout" : failures.size ? "failure" : "success",
        exitCode: timeout ? 2 : failures.size ? 1 : 0,
        deadlineMs,
        elapsedMs: performance.now() - started,
        cutoffAt,
        completedAt: new Date().toISOString(),
        remaining: { ...remaining },
        failures: [...failures],
      });
      const finish = (result: DrainResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        state = result.exitCode === 0 ? "STOPPED" : "FAILED";
        resolve(result);
        exit(result.exitCode);
      };
      const timer = setTimeout(() => {
        fail("timeout");
        forceCancel.abort();
        finish(snapshot(true));
      }, deadlineMs);
      stopAdmission.abort();
      for (const hook of cutoffHooks) {
        try {
          hook();
        } catch {
          fail("cutoff_failed");
        }
      }
      void (async () => {
        if (active())
          await new Promise<void>((done) => {
            notifyIdle = done;
          });
        if (finished) return;
        closed = true;
        for (const phase of [
          "transport",
          "dependency",
          "observability",
        ] as const) {
          for (const close of closers[phase]) {
            if (finished) return;
            try {
              await close();
            } catch {
              fail("closure_failed");
            }
          }
        }
        if (finished) return;
        try {
          await options.publish(snapshot());
        } catch {
          fail("evidence_failed");
        }
        if (finished) return;
        if (performance.now() - started >= deadlineMs) {
          fail("timeout");
          forceCancel.abort();
          finish(snapshot(true));
        } else finish(snapshot());
      })();
      return shutdownPromise;
    },
  };
  return runtime;
}
export type Lifecycle = ReturnType<typeof createLifecycle>;

/** Call synchronously before any asynchronous entrypoint startup. */
export function installLifecycleHandlers(runtime: Lifecycle) {
  const term = () => {
    void runtime.shutdown("SIGTERM");
  };
  const interrupt = () => {
    void runtime.shutdown("SIGINT");
  };
  const fatal = () => {
    void runtime.shutdown("fatal");
  };
  process.on("SIGTERM", term);
  process.on("SIGINT", interrupt);
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
  return () => {
    process.off("SIGTERM", term);
    process.off("SIGINT", interrupt);
    process.off("uncaughtException", fatal);
    process.off("unhandledRejection", fatal);
  };
}
