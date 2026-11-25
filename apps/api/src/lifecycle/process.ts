import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidence, type BootIdentity } from "./evidence.js";
import { createLifecycle, installLifecycleHandlers } from "./runtime.js";

/** Environment contract is local to the process; it never changes host settings. */
export function createProcessLifecycle(
  role: BootIdentity["role"],
  source: NodeJS.ProcessEnv = process.env,
  exit?: (code: 0 | 1 | 2) => void,
) {
  const values = [
    source.LIFECYCLE_EVIDENCE_DIRECTORY,
    source.LIFECYCLE_REQUEST_DIRECTORY,
    source.LIFECYCLE_RELEASE_ID,
    source.LIFECYCLE_IMAGE_DIGEST,
  ];
  const configured = values.every((value) => Boolean(value));
  if (
    (!configured && values.some((value) => value !== undefined)) ||
    (!configured && source.NODE_ENV === "production")
  )
    throw new Error(
      "Lifecycle evidence configuration must include directories and immutable release/image identity",
    );
  let evidence = configured
    ? createEvidence({
        role,
        evidenceDirectory: values[0]!,
        requestDirectory: values[1]!,
        releaseId: values[2]!,
        imageDigest: values[3]!,
      })
    : undefined;
  let binding: Promise<void> | undefined;
  const runtime = createLifecycle({
    exit,
    publish: async (result) => {
      if (!evidence || !binding)
        throw new Error("Lifecycle evidence unavailable");
      await binding;
      await evidence.publishTerminal(result);
    },
  });
  // Installed before mkdtemp, evidence publication, or application bootstrap.
  const dispose = installLifecycleHandlers(runtime);
  const bind = () => {
    if (evidence && !binding) {
      binding = evidence.readRequest();
      void binding.catch(() => runtime.fail("evidence_failed"));
    }
  };
  runtime.onCutoff(bind);
  let started = false;
  return {
    runtime,
    dispose,
    async start(bootstrap: () => Promise<void>) {
      if (started) throw new Error("Application startup already attempted");
      started = true;
      const release = runtime.admit("startup");
      if (!release) return;
      let failed = false;
      try {
        if (!evidence) {
          const directory = await mkdtemp(
            join(tmpdir(), `chalktalk-${role}-lifecycle-`),
          );
          // Development-only evidence is not trusted host-mounted replacement proof.
          evidence = createEvidence({
            role,
            evidenceDirectory: directory,
            requestDirectory: directory,
            releaseId: "local-development",
            imageDigest: `sha256:${"0".repeat(64)}`,
          });
        }
        await evidence.publishBoot();
        if (runtime.stopAdmission.aborted) bind();
        else {
          await bootstrap();
          runtime.markRunning();
        }
      } catch {
        failed = true;
        runtime.fail("owner_failed");
      } finally {
        release();
      }
      if (failed) await runtime.shutdown("fatal");
    },
  };
}
