import { CourseInformationService } from "./course-information/service.js";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { join } from "node:path";
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
import { CourseResourceService } from "./course-resources/service.js";
import { CourseFileService } from "./course-files/service.js";
import { createObservability, logApiEvent } from "./observability/index.js";
import { EmbeddingProvider, readEmbeddingConfig } from "./semantic/provider.js";
import { SemanticIndex } from "./semantic/index.js";
import { ContentAttachmentService } from "./content-attachments/service.js";
import { CollaborationSessionService } from "./collaboration/service.js";
import { NotificationService } from "./notifications/service.js";

const environment = loadEnvironment();
const { port } = environment;
const observability = environment.observability.enabled
  ? createObservability({
      token: environment.observability.metricsToken!,
      spool: {
        directory: join(environment.observability.spoolDirectory!, "api"),
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
pool.on("error", () => {
  logApiEvent(observability, "database_pool_error");
});
const app = createApp({
  environment,
  observability,
  authService: new AuthService(pool, environment, emailSender),
  courseService: new CourseService(pool),
  postService: new PostService(pool, observability, semantic),
  answerService: new AnswerService(pool),
  followupService: new FollowupService(pool),
  statisticsService: new StatisticsService(pool),
  courseFileService: new CourseFileService(pool, s3, bucket),
  courseResourceService: new CourseResourceService(pool),
  courseInformationService: new CourseInformationService(pool),
  contentAttachmentService: new ContentAttachmentService(pool, s3, bucket),
  notificationService: new NotificationService(pool),
  collaborationSessionService: new CollaborationSessionService(pool, {
    webSocketUrl: environment.collaboration.publicUrl,
    rateLimits: {
      createPerHour: environment.rateLimits.collaborationCreatePerUser,
      ticketsPerTenMinutes: environment.rateLimits.collaborationTicketPerUser,
    },
  }),
});
app.listen(port, () => {
  logApiEvent(observability, "api_started");
});
