import express from "express";
import { createProcessLifecycle } from "../lifecycle/process.js";
import { createHttpOwnership } from "../lifecycle/http.js";
import { ownedJob } from "./lifecycle.js";
import { ensureStorageBucket } from "../course-files/bucket.js";
import { S3Client } from "@aws-sdk/client-s3";
import { join } from "node:path";
import { createEmailSender } from "../auth/email.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../config/environment.js";
import { RESOURCE_TEXT_OCR_CONFIG } from "../config/constants.js";
import { createPool } from "../database/pool.js";
import { s3DigestImageReader } from "../digest/images.js";
import { DigestService } from "../digest/service.js";
import { runDigestScheduleLoop } from "../digest/runner.js";
import {
  createObservability,
  logApiEvent,
  logUnexpectedError,
  observeBackgroundOperation,
} from "../observability/index.js";
import { runJobLoop } from "./runner.js";
import { JobWorker } from "./worker.js";
import {
  EmbeddingProvider,
  readEmbeddingConfig,
} from "../semantic/provider.js";
import { SemanticIndex } from "../semantic/index.js";
import { missingExtractionTools } from "../resource-text/probe.js";

const application = createProcessLifecycle("worker");
const lifecycle = application.runtime;
const uncertain = () => {
  lifecycle.fail("uncertain_effect");
  void lifecycle.shutdown("fatal");
};
await application.start(async () => {
  const environment = loadEnvironment();
  const observability = environment.observability.enabled
    ? createObservability({
        token: environment.observability.metricsToken!,
        spool: {
          directory: join(environment.observability.spoolDirectory!, "worker"),
        },
      })
    : undefined;
  lifecycle.closeResource("observability", async () => {
    await observability?.close();
  });
  const pool = createPool(
    requireDatabaseUrl(environment),
    observability?.databaseObserver,
  );
  lifecycle.closeResource("dependency", () => pool.end());
  const embeddingConfig = readEmbeddingConfig();
  const semantic = embeddingConfig
    ? new SemanticIndex(
        pool,
        embeddingConfig,
        new EmbeddingProvider(embeddingConfig),
      )
    : undefined;
  pool.on("error", () => logApiEvent(observability, "database_pool_error"));
  const resourceText = RESOURCE_TEXT_OCR_CONFIG;
  const { bucket, client } = loadObjectStorageConfig();
  const s3 = new S3Client(client);
  lifecycle.closeResource("dependency", async () => {
    s3.destroy();
  });
  await ensureStorageBucket(s3, bucket, false);
  if (lifecycle.stopAdmission.aborted) return;
  const worker = new JobWorker(
    pool,
    undefined,
    createEmailSender(environment),
    environment.frontendBaseUrl,
    { client: s3, bucket },
    observability,
    semantic,
    resourceText,
    uncertain,
  );
  const digest = new DigestService(
    pool,
    createEmailSender(environment),
    environment.frontendBaseUrl,
    undefined,
    observability,
    s3DigestImageReader(s3, bucket),
    uncertain,
  );
  const probes = express();
  probes.use(
    createHttpOwnership(lifecycle, environment.frontendOrigins).admission,
  );
  if (observability) probes.get("/metrics", observability.metricsHandler);
  const metricsServer = probes.listen(environment.port);
  lifecycle.closeResource("transport", async () => {
    await new Promise<void>((resolve, reject) =>
      metricsServer.close((error) => (error ? reject(error) : resolve())),
    );
  });
  lifecycle.onCutoff(() => metricsServer.closeIdleConnections());
  lifecycle.forceCancel.addEventListener("abort", () =>
    metricsServer.closeAllConnections(),
  );
  // Without the OCR toolchain, extraction jobs stay pending until a fixed deployment runs them.
  const extractionReady =
    (await missingExtractionTools(resourceText.ocrLanguages)).length === 0;
  if (lifecycle.stopAdmission.aborted) return;
  if (!extractionReady)
    logApiEvent(observability, "resource_text_tools_unavailable");
  if (!lifecycle.markRunning()) return;
  const onError = (event: Parameters<typeof logUnexpectedError>[1]) => {
    logUnexpectedError(observability, event);
    lifecycle.fail("owner_failed");
    void lifecycle.shutdown("fatal");
  };
  const loops = [
    runJobLoop(
      ownedJob(lifecycle, () => worker.runOnce()),
      lifecycle.stopAdmission,
      1_000,
      () => onError("job_worker_failure"),
    ),
    ...(extractionReady
      ? [
          runJobLoop(
            ownedJob(lifecycle, () =>
              worker.runOnce("extraction", lifecycle.forceCancel),
            ),
            lifecycle.stopAdmission,
            1_000,
            () => onError("resource_text_job_failure"),
          ),
        ]
      : []),
    ...(semantic
      ? [
          runJobLoop(
            ownedJob(lifecycle, async () => {
              await semantic.queueBackfillOne();
              return false;
            }),
            lifecycle.stopAdmission,
            5_000,
            () => onError("semantic_backfill_failure"),
          ),
        ]
      : []),
    runJobLoop(
      ownedJob(lifecycle, () => digest.deliverOnce()),
      lifecycle.stopAdmission,
      1_000,
      () => onError("digest_delivery_failure"),
    ),
    runDigestScheduleLoop(
      ownedJob(lifecycle, async () => {
        await observeBackgroundOperation(observability, "digest_schedule", () =>
          digest.schedule(),
        );
        return false;
      }),
      lifecycle.stopAdmission,
      () => onError("digest_schedule_failure"),
    ),
  ];
  lifecycle.closeResource("transport", async () => {
    const outcomes = await Promise.allSettled(loops);
    if (outcomes.some((outcome) => outcome.status === "rejected"))
      throw new Error("Worker loop failed");
  });
  logApiEvent(observability, "worker_started");
});
