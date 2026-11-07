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
  createWorkerMetricsApp,
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

const environment = loadEnvironment();
const observability = environment.observability.enabled
  ? createObservability({
      token: environment.observability.metricsToken!,
      spool: {
        directory: join(environment.observability.spoolDirectory!, "worker"),
      },
    })
  : undefined;
const pool = createPool(requireDatabaseUrl(environment));
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
const worker = new JobWorker(
  pool,
  undefined,
  createEmailSender(environment),
  environment.frontendBaseUrl,
  { client: s3, bucket },
  observability,
  semantic,
  resourceText,
);
const digest = new DigestService(
  pool,
  createEmailSender(environment),
  environment.frontendBaseUrl,
  undefined,
  observability,
  s3DigestImageReader(s3, bucket),
);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const metricsServer = observability
  ? createWorkerMetricsApp(observability).listen(environment.port)
  : undefined;

logApiEvent(observability, "worker_started");
// Without the OCR toolchain, extraction jobs stay pending until a fixed deployment runs them.
const extractionReady =
  (await missingExtractionTools(resourceText.ocrLanguages)).length === 0;
if (!extractionReady)
  logApiEvent(observability, "resource_text_tools_unavailable");
try {
  await Promise.all([
    runJobLoop(
      () => worker.runOnce(),
      controller.signal,
      1_000,
      () => logUnexpectedError(observability, "job_worker_failure"),
    ),
    ...(extractionReady
      ? [
          runJobLoop(
            () => worker.runOnce("extraction", controller.signal),
            controller.signal,
            1_000,
            () =>
              logUnexpectedError(observability, "resource_text_job_failure"),
          ),
        ]
      : []),
    ...(semantic
      ? [
          runJobLoop(
            async () => {
              await semantic.queueBackfillOne();
              return false;
            },
            controller.signal,
            5_000,
            () =>
              logUnexpectedError(observability, "semantic_backfill_failure"),
          ),
        ]
      : []),
    runJobLoop(
      () => digest.deliverOnce(),
      controller.signal,
      1_000,
      () => logUnexpectedError(observability, "digest_delivery_failure"),
    ),
    runDigestScheduleLoop(
      () =>
        observeBackgroundOperation(observability, "digest_schedule", () =>
          digest.schedule(),
        ),
      controller.signal,
      () => logUnexpectedError(observability, "digest_schedule_failure"),
    ),
  ]);
} finally {
  if (metricsServer)
    await new Promise<void>((resolve, reject) =>
      metricsServer.close((error) => (error ? reject(error) : resolve())),
    );
  s3.destroy();
  await pool.end();
  logApiEvent(observability, "worker_stopped");
  await observability?.close();
}
