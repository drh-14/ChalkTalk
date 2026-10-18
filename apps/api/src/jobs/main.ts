import { S3Client } from "@aws-sdk/client-s3";
import { createEmailSender } from "../auth/email.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../config/environment.js";
import { createPool } from "../database/pool.js";
import { DigestService } from "../digest/service.js";
import { runDigestScheduleLoop } from "../digest/runner.js";
import { runJobLoop } from "./runner.js";
import { JobWorker } from "./worker.js";

const environment = loadEnvironment();
const pool = createPool(requireDatabaseUrl(environment));
const { bucket, client } = loadObjectStorageConfig();
const s3 = new S3Client(client);
const worker = new JobWorker(
  pool,
  undefined,
  createEmailSender(environment),
  environment.frontendBaseUrl,
  { client: s3, bucket },
);
const digest = new DigestService(
  pool,
  createEmailSender(environment),
  environment.frontendBaseUrl,
);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.info("ChalkTalk background worker started");
try {
  await Promise.all([
    runJobLoop(() => worker.runOnce(), controller.signal),
    runJobLoop(() => digest.deliverOnce(), controller.signal),
    runDigestScheduleLoop(() => digest.schedule(), controller.signal),
  ]);
} finally {
  s3.destroy();
  await pool.end();
  console.info("ChalkTalk background worker stopped");
}
