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
import { createObservability, logApiEvent } from "./observability/index.js";

const environment = loadEnvironment();
const { port } = environment;
const observability = environment.observability.enabled
  ? createObservability({
      token: environment.observability.metricsToken!,
      spool: { directory: environment.observability.spoolDirectory! },
    })
  : undefined;
const pool = createPool(requireDatabaseUrl(environment));
pool.on("error", () => {
  logApiEvent(observability, "database_pool_error");
});
const app = createApp({
  environment,
  observability,
  authService: new AuthService(
    pool,
    environment,
    createEmailSender(environment),
  ),
  courseService: new CourseService(pool),
  postService: new PostService(pool, observability),
  answerService: new AnswerService(pool),
  followupService: new FollowupService(pool),
  statisticsService: new StatisticsService(pool),
});
const worker = new JobWorker(pool, `api-${process.pid}`, observability);
let workerRunning = false;
setInterval(() => {
  if (workerRunning) return;
  workerRunning = true;
  void worker
    .runOnce()
    .catch(() => observability?.recordUnexpectedError("job_worker_failure"))
    .finally(() => {
      workerRunning = false;
    });
}, 1_000).unref();

app.listen(port, () => {
  logApiEvent(observability, "api_started");
});
