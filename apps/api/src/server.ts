import { createEmailSender } from "./auth/email.js";
import { FollowupService } from "./followups/service.js";
import { AnswerService } from "./answers/service.js";
import { AuthService } from "./auth/service.js";
import { loadEnvironment, requireDatabaseUrl } from "./config/environment.js";
import { createPool } from "./database/pool.js";
import { CourseService } from "./courses/service.js";
import { createApp } from "./http/app.js";
import { PostService } from "./posts/service.js";
import { StatisticsService } from "./statistics/service.js";

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
app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
