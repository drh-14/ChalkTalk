import { createProcessLifecycle } from "./lifecycle/process.js";
import type { Server } from "node:http";
import { CourseInformationService } from "./course-information/service.js";
import { S3Client } from "@aws-sdk/client-s3";
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
import { ensureStorageBucket } from "./course-files/bucket.js";
import { createObservability, logApiEvent } from "./observability/index.js";
import { EmbeddingProvider, readEmbeddingConfig } from "./semantic/provider.js";
import { SemanticIndex } from "./semantic/index.js";
import { ContentAttachmentService } from "./content-attachments/service.js";
import { ThreadAttachmentService } from "./threads/attachments.js";
import { ThreadService } from "./threads/service.js";
import { ThreadWatchService } from "./threads/watch.js";
import { CollaborationSessionService } from "./collaboration/service.js";
import { NotificationService } from "./notifications/service.js";
import { createThreadLiveServer } from "./threads/live.js";

const application = createProcessLifecycle("api");
const lifecycle = application.runtime;
const uncertain = () => {
  lifecycle.fail("uncertain_effect");
  void lifecycle.shutdown("fatal");
};
let server: Server | undefined;
let threadLive: ReturnType<typeof createThreadLiveServer> | undefined;
lifecycle.onCutoff(() => {
  threadLive?.cutoff();
  server?.closeIdleConnections();
});
await application.start(async () => {
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
  lifecycle.closeResource("observability", async () => {
    await observability?.close();
  });
  const pool = createPool(
    requireDatabaseUrl(environment),
    observability?.databaseObserver,
  );
  lifecycle.closeResource("dependency", () => pool.end());
  const embeddingConfig = readEmbeddingConfig();
  const semantic = embeddingConfig
    ? new SemanticIndex(
        pool,
        embeddingConfig,
        new EmbeddingProvider(embeddingConfig),
      )
    : undefined;
  const emailSender = createEmailSender(environment);
  const authService = new AuthService(pool, environment, emailSender);
  const { bucket, client } = loadObjectStorageConfig();
  const s3 = new S3Client(client);
  lifecycle.closeResource("dependency", async () => {
    s3.destroy();
  });
  await ensureStorageBucket(s3, bucket, false);
  if (lifecycle.stopAdmission.aborted) return;
  pool.on("error", () => {
    logApiEvent(observability, "database_pool_error");
  });
  const app = createApp({
    environment,
    lifecycle,
    observability,
    authService,
    courseService: new CourseService(pool),
    postService: new PostService(pool, observability, semantic),
    answerService: new AnswerService(pool),
    followupService: new FollowupService(pool),
    statisticsService: new StatisticsService(pool),
    courseFileService: new CourseFileService(pool, s3, bucket, uncertain),
    courseResourceService: new CourseResourceService(pool),
    courseInformationService: new CourseInformationService(pool),
    contentAttachmentService: new ContentAttachmentService(
      pool,
      s3,
      bucket,
      uncertain,
    ),
    threadAttachmentService: new ThreadAttachmentService(
      pool,
      s3,
      bucket,
      uncertain,
    ),
    threadService: new ThreadService(pool),
    threadWatchService: new ThreadWatchService(pool),
    notificationService: new NotificationService(pool),
    collaborationSessionService: new CollaborationSessionService(pool, {
      webSocketUrl: environment.collaboration.publicUrl,
      rateLimits: {
        createPerHour: environment.rateLimits.collaborationCreatePerUser,
        ticketsPerTenMinutes: environment.rateLimits.collaborationTicketPerUser,
      },
    }),
  });
  server = app.listen(port);
  lifecycle.closeResource("transport", async () => {
    const outcomes = await Promise.allSettled([
      threadLive?.stop(),
      ...(server?.listening
        ? [
            new Promise<void>((resolve, reject) =>
              server!.close((error) => (error ? reject(error) : resolve())),
            ),
          ]
        : []),
    ]);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
  lifecycle.forceCancel.addEventListener(
    "abort",
    () => server?.closeAllConnections(),
    { once: true },
  );
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", reject);
  });
  if (lifecycle.stopAdmission.aborted) return;
  threadLive = createThreadLiveServer({
    server,
    pool,
    authService,
    frontendOrigins: environment.frontendOrigins,
    accepting: () => lifecycle.ready,
  });
  await threadLive.start();
  if (!lifecycle.stopAdmission.aborted)
    logApiEvent(observability, "api_started");
});
