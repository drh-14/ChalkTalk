import { S3Client } from "@aws-sdk/client-s3";
import { join } from "node:path";
import { createEmailSender } from "../auth/email.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../config/environment.js";
import { createPool } from "../database/pool.js";
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
pool.on("error", () => logApiEvent(observability, "database_pool_error"));
const { bucket, client } = loadObjectStorageConfig();
const s3 = new S3Client(client);
const worker = new JobWorker(
  pool,
  undefined,
  createEmailSender(environment),
  environment.frontendBaseUrl,
  { client: s3, bucket },
  observability,
);
const digest = new DigestService(
  pool,
  createEmailSender(environment),
  environment.frontendBaseUrl,
  undefined,
  observability,
);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const metricsServer = observability
  ? createWorkerMetricsApp(observability).listen(environment.port)
  : undefined;

logApiEvent(observability, "worker_started");
try {
  await Promise.all([
    runJobLoop(
      () => worker.runOnce(),
      controller.signal,
      1_000,
      () => logUnexpectedError(observability, "job_worker_failure"),
    ),
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
