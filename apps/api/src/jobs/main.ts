import { S3Client } from "@aws-sdk/client-s3";
import { createEmailSender } from "../auth/email.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "../config/environment.js";
import { createPool } from "../database/pool.js";
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
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.info("ChalkTalk background worker started");
try {
  await runJobLoop(() => worker.runOnce(), controller.signal);
} finally {
  s3.destroy();
  await pool.end();
  console.info("ChalkTalk background worker stopped");
}
