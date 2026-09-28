import { createEmailSender } from "./auth/email.js";
import { AnswerService } from "./answers/service.js";
import { AuthService } from "./auth/service.js";
import { loadEnvironment, requireDatabaseUrl } from "./config/environment.js";
import { createPool } from "./database/pool.js";
import { CourseService } from "./courses/service.js";
import { JobWorker } from "./jobs/worker.js";
import { createApp } from "./http/app.js";
import { PostService } from "./posts/service.js";

const environment = loadEnvironment();
const { port } = environment;
const pool = createPool(requireDatabaseUrl(environment));
const app = createApp({
  environment,
  authService: new AuthService(
    pool,
    environment,
    createEmailSender(environment),
  ),
  courseService: new CourseService(pool),
  postService: new PostService(pool),
  answerService: new AnswerService(pool),
});
const worker = new JobWorker(pool);
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

app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
