import {
  createLifecycle,
  installLifecycleHandlers,
} from "../../apps/api/src/lifecycle/runtime.js";
import {
  createEvidence,
  type EvidenceIO,
} from "../../apps/api/src/lifecycle/evidence.js";
import * as fs from "node:fs/promises";

const mode = process.argv[2];
const evidenceDirectory = process.env.LIFECYCLE_TEST_DIRECTORY;
let terminal = false;
const io: EvidenceIO = {
  ...fs,
  open: async (...args) => {
    const handle = await fs.open(...args);
    return new Proxy(handle, {
      get(target, key) {
        if (key === "writeFile" && mode === "evidence-write-hang" && terminal)
          return async () => {
            await new Promise(() => {});
          };
        if (key === "sync")
          return async () => {
            if (
              terminal &&
              mode === "directory-sync-error" &&
              args[0] === evidenceDirectory
            )
              throw new Error("private sync error");
            return target.sync();
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  },
};
const evidence = evidenceDirectory
  ? createEvidence(
      {
        role: "api",
        releaseId: "a".repeat(40),
        imageDigest: `sha256:${"b".repeat(64)}`,
        evidenceDirectory,
        requestDirectory: evidenceDirectory,
      },
      io,
    )
  : undefined;
let binding: Promise<void> | undefined;
const runtime = createLifecycle({
  deadlineMs: mode === "timeout" ? 150 : 2000,
  publish: async (result) => {
    if (evidence) {
      await binding;
      terminal = true;
      await evidence.publishTerminal(result);
    }
    process.send?.({ receipt: result });
    if (mode === "evidence-hang") await new Promise(() => {});
  },
});
installLifecycleHandlers(runtime);
const release = runtime.admit("startup")!;
runtime.onCutoff(() => {
  binding = evidence?.readRequest();
  // Observe immediately, while retaining the rejected binding for publication.
  void binding?.catch(() => runtime.fail("evidence_failed"));
  process.send?.({ cutoff: true });
});
runtime.closeResource("dependency", async () => {
  if (mode === "close-error")
    throw new Error("sensitive credential must not leak");
});
process.on("message", (message) => {
  if (message === "release") {
    process.send?.({ lateRunning: runtime.markRunning() });
    release();
  }
  if (message === "fatal") void Promise.reject(new Error("private error"));
});
if (evidence) await evidence.publishBoot();
process.send?.({ started: true, identity: evidence?.identity });
