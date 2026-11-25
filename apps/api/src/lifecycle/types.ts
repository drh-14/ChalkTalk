export type LifecycleState =
  "STARTING" | "RUNNING" | "DRAINING" | "STOPPED" | "FAILED";
export type WorkKind =
  | "startup"
  | "handler"
  | "admission"
  | "store"
  | "job"
  | "heartbeat"
  | "child"
  | "listener";
export type FailureCode =
  | "fatal"
  | "owner_failed"
  | "cutoff_failed"
  | "closure_failed"
  | "evidence_failed"
  | "timeout"
  | "uncertain_effect"
  | "ownership_lost"
  | "persistence_failed";
export type ShutdownTrigger = "SIGTERM" | "SIGINT" | "fatal";
export type DrainResult = {
  trigger: ShutdownTrigger;
  result: "success" | "failure" | "timeout";
  exitCode: 0 | 1 | 2;
  deadlineMs: number;
  elapsedMs: number;
  cutoffAt: string;
  completedAt: string;
  remaining: Record<WorkKind, number>;
  failures: FailureCode[];
};
