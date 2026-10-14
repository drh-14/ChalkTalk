import { createEmailSender } from "./auth/email.js";
import { FollowupService } from "./followups/service.js";
import { AnswerService } from "./answers/service.js";
import { AuthService } from "./auth/service.js";
import { loadEnvironment, requireDatabaseUrl } from "./config/environment.js";
import { createPool } from "./database/pool.js";
import { CourseService } from "./courses/service.js";
import { JobWorker } from "./jobs/worker.js";
import { createApp } from "./http/app.js";
import { PostService } from "./posts/service.js";
import { StatisticsService } from "./statistics/service.js";
import { DigestService } from "./digest/service.js";

const environment = loadEnvironment();
const { port } = environment;
const pool = createPool(requireDatabaseUrl(environment));
const emailSender = createEmailSender(environment);
const app = createApp({
  environment,
  authService: new AuthService(pool, environment, emailSender),
  courseService: new CourseService(pool),
  postService: new PostService(pool),
  answerService: new AnswerService(pool),
  followupService: new FollowupService(pool),
  statisticsService: new StatisticsService(pool),
});
const worker = new JobWorker(pool);
const digest = new DigestService(
  pool,
  emailSender,
  environment.frontendBaseUrl,
);
let workerRunning = false;
setInterval(() => {
  if (workerRunning) return;
  workerRunning = true;
  void worker
    .runOnce()
    .catch((error: unknown) => console.error("Course job failed", error))
    .finally(() => {
      workerRunning = false;
    });
}, 1_000).unref();

let digestScheduling = false;
async function scheduleDigests(): Promise<void> {
  if (digestScheduling) return;
  digestScheduling = true;
  try {
    await digest.schedule();
  } catch (error) {
    console.error("Daily digest scheduling failed", error);
  } finally {
    digestScheduling = false;
  }
}

function scheduleNextMidnight(): void {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  setTimeout(() => {
    void scheduleDigests();
    scheduleNextMidnight();
  }, next - now.getTime()).unref();
}

void scheduleDigests();
scheduleNextMidnight();
setInterval(() => void scheduleDigests(), 60_000).unref();

let digestDelivering = false;
setInterval(() => {
  if (digestDelivering) return;
  digestDelivering = true;
  void digest
    .deliverOnce()
    .catch((error: unknown) =>
      console.error("Daily digest delivery failed", error),
    )
    .finally(() => {
      digestDelivering = false;
    });
}, 1_000).unref();

app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
