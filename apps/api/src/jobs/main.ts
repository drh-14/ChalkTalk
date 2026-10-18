import { createEmailSender } from "../auth/email.js";
import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "../database/pool.js";
import { runJobLoop } from "./runner.js";
import { JobWorker } from "./worker.js";

const environment = loadEnvironment();
const pool = createPool(requireDatabaseUrl(environment));
const worker = new JobWorker(
  pool,
  undefined,
  createEmailSender(environment),
  environment.frontendBaseUrl,
);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.info("ChalkTalk background worker started");
try {
  await runJobLoop(() => worker.runOnce(), controller.signal);
} finally {
  await pool.end();
  console.info("ChalkTalk background worker stopped");
}
