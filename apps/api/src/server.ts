import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { createEmailSender } from "./auth/email.js";
import { FollowupService } from "./followups/service.js";
import { AnswerService } from "./answers/service.js";
import { AuthService } from "./auth/service.js";
import {
  loadEnvironment,
  loadObjectStorageConfig,
  requireDatabaseUrl,
} from "./config/environment.js";
import { createPool } from "./database/pool.js";
import { CourseService } from "./courses/service.js";
import { createApp } from "./http/app.js";
import { PostService } from "./posts/service.js";
import { StatisticsService } from "./statistics/service.js";
import { CourseFileService } from "./course-files/service.js";

const environment = loadEnvironment();
const { port } = environment;
const pool = createPool(requireDatabaseUrl(environment));
const emailSender = createEmailSender(environment);
const { bucket, endpoint, client } = loadObjectStorageConfig();
const s3 = new S3Client(client);
if (endpoint) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("$metadata" in error) ||
      (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 404
    )
      throw error;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

const app = createApp({
  environment,
  authService: new AuthService(pool, environment, emailSender),
  courseService: new CourseService(pool),
  postService: new PostService(pool),
  answerService: new AnswerService(pool),
  followupService: new FollowupService(pool),
  statisticsService: new StatisticsService(pool),
  courseFileService: new CourseFileService(pool, s3, bucket),
});
app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
