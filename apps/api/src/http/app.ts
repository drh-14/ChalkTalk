import {
  CourseInformationService,
  informationEtag,
} from "../course-information/service.js";
import { randomUUID } from "node:crypto";
import {
  logUnexpectedError,
  type Observability,
} from "../observability/index.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  AnswerService,
  answerEtag,
  type CreateAnswer,
} from "../answers/service.js";
import { FollowupService, followupEtag } from "../followups/service.js";
import { SESSION_COOKIE_NAME, sessionCookie } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import {
  AuthService,
  normalizeEmail,
  type UserProfile,
  userEtag,
} from "../auth/service.js";
import type { Environment } from "../config/environment.js";
import { CourseService, courseEtag } from "../courses/service.js";
import {
  PostService,
  postEtag,
  type CreatePost,
  type ListPosts,
  type UpdatePost,
} from "../posts/service.js";
import { StatisticsService } from "../statistics/service.js";
import { CourseFileService } from "../course-files/service.js";
import { readMultipart } from "../course-files/multipart.js";
import {
  ContentAttachmentService,
  type ParentKind,
} from "../content-attachments/service.js";
import {
  COLLABORATION_LANGUAGES,
  CollaborationSessionService,
  collaborationEtag,
  type CollaborationLanguage,
  type CreateCollaborationSession,
  type UpdateCollaborationSession,
} from "../collaboration/service.js";
import { NotificationService } from "../notifications/service.js";

import {
  resourceEtag,
  CourseResourceService,
} from "../course-resources/service.js";

export interface AppDependencies {
  environment: Environment;
  authService?: AuthService;
  courseService?: CourseService;
  postService?: PostService;
  answerService?: AnswerService;
  followupService?: FollowupService;
  statisticsService?: StatisticsService;
  courseFileService?: CourseFileService;
  courseResourceService?: CourseResourceService;
  courseInformationService?: CourseInformationService;
  observability?: Observability;
  contentAttachmentService?: ContentAttachmentService;
  collaborationSessionService?: CollaborationSessionService;
  notificationService?: NotificationService;
}
type AuthContext = {
  credential: string;
  session: Awaited<ReturnType<AuthService["session"]>>;
};

function testEnvironment(): Environment {
  return {
    databaseUrl: undefined,
    port: 3000,
    trustProxyHops: 0,
    frontendOrigins: new Set(["https://localhost:5173"]),
    frontendBaseUrl: "https://localhost:5173",
    authTokenSecret: "test-secret-that-is-longer-than-thirty-two-characters",
    allowedSchoolDomains: new Set(["example.edu"]),
    rateLimits: {
      verificationPerEmail: 5,
      verificationPerIp: 100,
      loginPerEmail: 10,
      loginPerIp: 100,
      resetPerEmail: 5,
      resetPerIp: 100,
      signupPerIp: 100,
      collaborationCreatePerUser: 30,
      collaborationTicketPerUser: 300,
    },
    observability: {
      enabled: false,
      metricsToken: undefined,
      spoolDirectory: undefined,
    },
    collaboration: {
      port: 3100,
      publicUrl: "wss://localhost:5173/collaboration",
      idleEndMinutes: 120,
    },
    smtp: {
      host: "localhost",
      port: 1025,
      secure: false,
      user: undefined,
      password: undefined,
      from: "test@example.edu",
    },
  };
}
function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.header("cookie") ?? "").split(";").flatMap((part) => {
      const index = part.indexOf("=");
      return index < 1
        ? []
        : [
            [
              part.slice(0, index).trim(),
              decodeURIComponent(part.slice(index + 1).trim()),
            ],
          ];
    }),
  );
}
function profileResponse(
  response: Response,
  profile: UserProfile,
  status = 200,
): Response {
  return response
    .status(status)
    .set("ETag", userEtag(profile))
    .json({ data: profile });
}
function originGuard(environment: Environment) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    if (
      !origin ||
      origin === "null" ||
      !environment.frontendOrigins.has(origin)
    )
      return next(
        new AuthError(403, "origin_not_allowed", "Origin is not allowed"),
      );
    response.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
    return next();
  };
}

function safeReadOrigin(environment: Environment) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    if (
      !origin ||
      origin === "null" ||
      !environment.frontendOrigins.has(origin)
    )
      return next();
    response.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
    return next();
  };
}

type JsonObject = Record<string, unknown>;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validationError(message = "Request body is invalid"): AuthError {
  return new AuthError(422, "validation_failed", message);
}

function strictBody(
  input: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw validationError();
  const body = input as JsonObject;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw validationError("Request body has an unknown property");
  if (required.some((key) => body[key] === undefined))
    throw validationError("Request body is missing a required property");
  return body;
}

function stringWithin(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  )
    throw validationError(`${field} is invalid`);
  return value;
}

function verificationRequestBody(input: unknown): JsonObject {
  const body = strictBody(input, ["email"], ["email"]);
  stringWithin(body.email, "Email", 1, 255);
  return body;
}

function accountCreationBody(input: unknown): JsonObject & {
  verificationToken: unknown;
  password: unknown;
  displayName: unknown;
} {
  const body = strictBody(
    input,
    ["verificationToken", "password", "displayName"],
    ["verificationToken", "password", "displayName"],
  );
  stringWithin(body.verificationToken, "Verification token", 1, 4096);
  stringWithin(body.password, "Password", 0, 128);
  stringWithin(body.displayName, "Display name", 1, 100);
  return body as JsonObject & {
    verificationToken: unknown;
    password: unknown;
    displayName: unknown;
  };
}

function sessionCreationBody(input: unknown): JsonObject {
  const body = strictBody(input, ["email", "password"], ["email", "password"]);
  stringWithin(body.email, "Email", 1, 255);
  stringWithin(body.password, "Password", 1, 128);
  return body;
}

function profileUpdateBody(input: unknown): JsonObject {
  const body = strictBody(input, ["displayName", "emailVerificationToken"]);
  if (
    body.displayName === undefined &&
    body.emailVerificationToken === undefined
  )
    throw validationError("A profile field is required");
  if (body.displayName !== undefined)
    stringWithin(body.displayName, "Display name", 1, 100);
  if (body.emailVerificationToken !== undefined)
    stringWithin(body.emailVerificationToken, "Verification token", 1, 4096);
  return body;
}

function passwordChangeBody(input: unknown): JsonObject {
  const body = strictBody(
    input,
    ["currentPassword", "newPassword"],
    ["currentPassword", "newPassword"],
  );
  stringWithin(body.currentPassword, "Current password", 1, 128);
  stringWithin(body.newPassword, "New password", 0, 128);
  return body;
}

function passwordResetRequestBody(input: unknown): JsonObject {
  const body = strictBody(input, ["email"], ["email"]);
  try {
    stringWithin(body.email, "Email", 1, 255);
    normalizeEmail(body.email);
  } catch {
    throw new AuthError(400, "invalid_request", "Request body is invalid");
  }
  return body;
}

function passwordResetBody(input: unknown): JsonObject {
  const body = strictBody(
    input,
    ["token", "newPassword"],
    ["token", "newPassword"],
  );
  stringWithin(body.token, "Reset token", 1, 2048);
  stringWithin(body.newPassword, "New password", 0, 128);
  return body;
}

function accountDeletionBody(input: unknown): JsonObject {
  const body = strictBody(input, ["currentPassword"], ["currentPassword"]);
  stringWithin(body.currentPassword, "Current password", 1, 128);
  return body;
}

function listQuery(
  query: Request["query"],
  filter?: { key: "status" | "role"; values: readonly string[] },
  defaultLimit = 25,
) {
  const rawLimit = query.limit;
  const limit =
    rawLimit === undefined
      ? defaultLimit
      : typeof rawLimit === "string"
        ? Number(rawLimit)
        : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new AuthError(400, "invalid_request", "Pagination is invalid");
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" ||
      query.cursor.length < 1 ||
      query.cursor.length > 2048)
  )
    throw new AuthError(400, "invalid_request", "Pagination is invalid");
  const rawFilter = filter ? query[filter.key] : undefined;
  if (
    filter &&
    rawFilter !== undefined &&
    (typeof rawFilter !== "string" || !filter.values.includes(rawFilter))
  )
    throw new AuthError(400, "invalid_request", "Filter is invalid");
  return {
    limit,
    cursor: query.cursor as string | undefined,
    filter: typeof rawFilter === "string" ? rawFilter : undefined,
  };
}
function followupListQuery(query: Request["query"]) {
  if (Object.keys(query).some((key) => key !== "cursor" && key !== "limit"))
    throw new AuthError(400, "invalid_request", "Pagination is invalid");
  return listQuery(query, undefined, 20);
}
function courseCreateBody(input: unknown): JsonObject {
  const body = strictBody(input, ["name"], ["name"]);
  stringWithin(body.name, "Course name", 1, 200);
  return body;
}
function joinCourseBody(input: unknown): JsonObject {
  const body = strictBody(input, ["joinCode"], ["joinCode"]);
  if (typeof body.joinCode !== "string" || !/^[A-Z0-9]{8}$/.test(body.joinCode))
    throw new AuthError(422, "invalid_join_code", "Join code is invalid");
  return body;
}
function courseUpdateBody(input: unknown): JsonObject {
  const switches = [
    "allowAnonymousPosting",
    "allowPrivatePosting",
    "allowFollowupResolution",
  ];
  const body = strictBody(input, ["name", "status", ...switches]);
  if (
    body.name === undefined &&
    body.status === undefined &&
    switches.every((key) => body[key] === undefined)
  )
    throw validationError();
  if (body.name !== undefined) stringWithin(body.name, "Course name", 1, 200);
  if (
    body.status !== undefined &&
    body.status !== "active" &&
    body.status !== "archived"
  )
    throw validationError();
  if (
    switches.some(
      (key) => body[key] !== undefined && typeof body[key] !== "boolean",
    )
  )
    throw validationError();
  return body;
}
function memberUpdateBody(input: unknown): JsonObject {
  const body = strictBody(input, ["role"], ["role"]);
  if (
    body.role !== "student" &&
    body.role !== "ta" &&
    body.role !== "instructor"
  )
    throw validationError("Role is invalid");
  return body;
}
function emailPreferencesBody(input: unknown): {
  activityEmails?: boolean;
  announcementEmails?: boolean;
  digestEmails?: boolean;
} {
  const body = strictBody(input, [
    "activityEmails",
    "announcementEmails",
    "digestEmails",
  ]);
  if (
    !Object.keys(body).length ||
    Object.values(body).some((value) => typeof value !== "boolean")
  )
    throw validationError("Email preferences must be booleans");
  return body;
}
function requireJsonRequest(request: Request): void {
  if (!request.is("application/json"))
    throw new AuthError(
      422,
      "validation_failed",
      "Content-Type must be application/json",
    );
}

function postTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10)
    throw validationError("Tags are invalid");
  const names = value.map((item) => {
    if (typeof item !== "string") throw validationError("Tags are invalid");
    const name = item.trim().toLowerCase();
    if (!name || name.length > 40) throw validationError("Tags are invalid");
    return name;
  });
  if (new Set(names).size !== names.length)
    throw validationError("Tags are invalid");
  return names;
}
function pollOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10)
    throw validationError("A poll needs 2 to 10 options");
  const labels = value.map((item) => {
    const label =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as { label?: unknown }).label
        : undefined;
    if (
      typeof label !== "string" ||
      Object.keys(item as object).some((key) => key !== "label")
    )
      throw validationError("Poll options are invalid");
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 200)
      throw validationError("Poll option labels must be 1 to 200 characters");
    return trimmed;
  });
  if (
    new Set(labels.map((label) => label.toLowerCase())).size !== labels.length
  )
    throw validationError("Poll options must be distinct");
  return labels;
}
function postCreateBody(value: unknown): CreatePost {
  const body = strictBody(
    value,
    [
      "type",
      "title",
      "bodyMarkdown",
      "anonymous",
      "tags",
      "options",
      "announcement",
      "private",
    ],
    ["type", "title", "bodyMarkdown"],
  );
  if (body.type !== "question" && body.type !== "note" && body.type !== "poll")
    throw validationError("Post type is invalid");
  const title = stringWithin(body.title, "Title", 1, 200);
  const bodyMarkdown = stringWithin(body.bodyMarkdown, "Body", 1, 100000);
  if (body.anonymous !== undefined && typeof body.anonymous !== "boolean")
    throw validationError("Anonymous is invalid");
  if (
    body.type === "poll"
      ? body.options === undefined
      : body.options !== undefined
  )
    throw validationError("Only polls have options");
  if (body.announcement !== undefined && typeof body.announcement !== "boolean")
    throw validationError("Announcement is invalid");
  if (body.announcement && body.type !== "note")
    throw validationError("Only notes can be announcements");
  if (body.announcement && body.anonymous)
    throw validationError("Announcements cannot be anonymous");
  if (body.private !== undefined && typeof body.private !== "boolean")
    throw validationError("Private is invalid");
  return {
    type: body.type,
    title,
    bodyMarkdown,
    anonymous: body.anonymous as boolean | undefined,
    tags: postTags(body.tags),
    ...(body.type === "poll" ? { options: pollOptions(body.options) } : {}),
    ...(body.announcement ? { announcement: true } : {}),
    ...(body.private ? { private: true } : {}),
  };
}
function answerCreateBody(value: unknown): CreateAnswer {
  const body = strictBody(
    value,
    ["bodyMarkdown", "anonymous"],
    ["bodyMarkdown"],
  );
  const bodyMarkdown = stringWithin(body.bodyMarkdown, "Body", 1, 100000);
  if (!bodyMarkdown.trim()) throw validationError("Body is invalid");
  if (body.anonymous !== undefined && typeof body.anonymous !== "boolean")
    throw validationError("Anonymous is invalid");
  return { bodyMarkdown, anonymous: body.anonymous as boolean | undefined };
}
function postListQuery(query: Request["query"]): ListPosts {
  const allowed = new Set([
    "q",
    "semanticQuery",
    "type",
    "tag",
    "tagMatch",
    "authorId",
    "createdAfter",
    "createdBefore",
    "answered",
    "pinned",
    "announcement",
    "private",
    "unresolvedFollowups",
    "authorRole",
    "duplicateStatus",
    "sort",
    "cursor",
    "limit",
  ]);
  if (Object.keys(query).some((key) => !allowed.has(key)))
    throw new AuthError(400, "invalid_request", "Filter is invalid");
  const one = (key: string): string | undefined => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string")
      throw new AuthError(400, "invalid_request", "Filter is invalid");
    return value;
  };
  const q = one("q")?.trim();
  if (q !== undefined && (q.length < 1 || q.length > 500))
    throw new AuthError(400, "invalid_request", "Search query is invalid");
  const semanticQuery = one("semanticQuery")?.trim();
  if (
    semanticQuery !== undefined &&
    (!q || semanticQuery.length < 1 || semanticQuery.length > 500)
  )
    throw new AuthError(400, "invalid_request", "Semantic query is invalid");
  const type = one("type");
  if (
    type !== undefined &&
    type !== "question" &&
    type !== "note" &&
    type !== "poll"
  )
    throw new AuthError(400, "invalid_request", "Type is invalid");
  const rawTags =
    query.tag === undefined
      ? []
      : Array.isArray(query.tag)
        ? query.tag
        : [query.tag];
  if (
    rawTags.length > 10 ||
    rawTags.some(
      (tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40,
    )
  )
    throw new AuthError(400, "invalid_request", "Tag is invalid");
  const tags = [
    ...new Set((rawTags as string[]).map((tag) => tag.trim().toLowerCase())),
  ];
  const tagMatch = one("tagMatch");
  if (tagMatch !== undefined && tagMatch !== "any" && tagMatch !== "all")
    throw new AuthError(400, "invalid_request", "Tag match is invalid");
  const authorId = one("authorId");
  if (authorId !== undefined && !UUID_PATTERN.test(authorId))
    throw new AuthError(400, "invalid_request", "Author is invalid");
  const createdAfter = one("createdAfter");
  const createdBefore = one("createdBefore");
  for (const date of [createdAfter, createdBefore])
    if (date !== undefined && (!date || Number.isNaN(Date.parse(date))))
      throw new AuthError(400, "invalid_request", "Date is invalid");
  if (
    createdAfter &&
    createdBefore &&
    Date.parse(createdAfter) > Date.parse(createdBefore)
  )
    throw new AuthError(400, "invalid_request", "Date range is invalid");
  const rawAnswered = one("answered");
  if (
    rawAnswered !== undefined &&
    rawAnswered !== "true" &&
    rawAnswered !== "false"
  )
    throw new AuthError(400, "invalid_request", "Answered is invalid");
  const rawPinned = one("pinned");
  if (rawPinned !== undefined && rawPinned !== "true" && rawPinned !== "false")
    throw new AuthError(400, "invalid_request", "Pinned is invalid");
  const rawAnnouncement = one("announcement");
  if (rawAnnouncement !== undefined && rawAnnouncement !== "true")
    throw new AuthError(400, "invalid_request", "Announcement is invalid");
  const rawPrivate = one("private");
  if (rawPrivate !== undefined && rawPrivate !== "true")
    throw new AuthError(400, "invalid_request", "Private is invalid");
  const rawUnresolved = one("unresolvedFollowups");
  if (rawUnresolved !== undefined && rawUnresolved !== "true")
    throw new AuthError(
      400,
      "invalid_request",
      "Unresolved followups filter is invalid",
    );
  const authorRole = one("authorRole");
  if (
    authorRole !== undefined &&
    authorRole !== "instructor" &&
    authorRole !== "ta"
  )
    throw new AuthError(400, "invalid_request", "Author role is invalid");
  const duplicateStatus = one("duplicateStatus");
  if (
    duplicateStatus !== undefined &&
    !["none", "suggested", "confirmed"].includes(duplicateStatus)
  )
    throw new AuthError(400, "invalid_request", "Duplicate status is invalid");
  const sort = one("sort") ?? (q ? "relevance" : "recent_activity");
  if (
    !["relevance", "newest", "oldest", "recent_activity"].includes(sort) ||
    (sort === "relevance" && !q)
  )
    throw new AuthError(400, "invalid_request", "Sort is invalid");
  const rawLimit = one("limit");
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new AuthError(400, "invalid_request", "Pagination is invalid");
  const cursor = one("cursor");
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 2048))
    throw new AuthError(400, "invalid_request", "Pagination cursor is invalid");
  return {
    q,
    semanticQuery,
    type: type as ListPosts["type"],
    tags,
    // Any and all agree below two tags, so only a distinct all-match binds cursors.
    tagMatch: tagMatch === "all" && tags.length > 1 ? "all" : undefined,
    authorId,
    createdAfter,
    createdBefore,
    answered: rawAnswered === undefined ? undefined : rawAnswered === "true",
    pinned: rawPinned === undefined ? undefined : rawPinned === "true",
    announcement: rawAnnouncement === "true" ? true : undefined,
    private: rawPrivate === "true" ? true : undefined,
    unresolvedFollowups: rawUnresolved === "true" ? true : undefined,
    authorRole: authorRole as ListPosts["authorRole"],
    duplicateStatus: duplicateStatus as ListPosts["duplicateStatus"],
    sort: sort as ListPosts["sort"],
    limit,
    cursor,
  };
}
function collaborationTitle(value: unknown): string {
  if (typeof value !== "string") throw validationError("Title is invalid");
  const title = value.trim();
  if (title.length < 1 || title.length > 120)
    throw validationError("Title is invalid");
  return title;
}

function collaborationLanguage(value: unknown): CollaborationLanguage {
  if (
    typeof value !== "string" ||
    !(COLLABORATION_LANGUAGES as readonly string[]).includes(value)
  )
    throw validationError("Language is invalid");
  return value as CollaborationLanguage;
}

function collaborationCreateBody(value: unknown): CreateCollaborationSession {
  const body = strictBody(value, ["anchor", "title", "language"], ["anchor"]);
  const anchor = strictBody(body.anchor, ["postId"], ["postId"]);
  return {
    postId: stringWithin(anchor.postId, "Anchor", 1, 255),
    ...(body.title === undefined
      ? {}
      : { title: collaborationTitle(body.title) }),
    ...(body.language === undefined
      ? {}
      : { language: collaborationLanguage(body.language) }),
  };
}

function collaborationUpdateBody(value: unknown): UpdateCollaborationSession {
  const body = strictBody(value, ["title", "language", "status"]);
  if (!Object.keys(body).length)
    throw validationError("Request body must change something");
  if (body.status !== undefined) {
    if (body.status !== "ended" || Object.keys(body).length !== 1)
      throw validationError("Status must be ended and cannot be combined");
    return { status: "ended" };
  }
  return {
    ...(body.title === undefined
      ? {}
      : { title: collaborationTitle(body.title) }),
    ...(body.language === undefined
      ? {}
      : { language: collaborationLanguage(body.language) }),
  };
}

function collaborationListQuery(query: Request["query"]) {
  const { limit, cursor, filter } = listQuery(query, {
    key: "status",
    values: ["active", "ended"],
  });
  if (query.anchorType !== undefined && query.anchorType !== "post")
    throw new AuthError(400, "invalid_request", "Filter is invalid");
  if (
    query.anchorId !== undefined &&
    (typeof query.anchorId !== "string" ||
      query.anchorId.length < 1 ||
      query.anchorId.length > 255)
  )
    throw new AuthError(400, "invalid_request", "Filter is invalid");
  return {
    limit,
    cursor,
    status: filter as "active" | "ended" | undefined,
    anchorId: query.anchorId as string | undefined,
  };
}

function postUpdateBody(value: unknown): UpdatePost {
  const body = strictBody(value, [
    "title",
    "bodyMarkdown",
    "anonymous",
    "tags",
    "pinned",
    "duplicateOfPostId",
    "duplicateStatus",
    "private",
  ]);
  if (Object.keys(body).length === 0)
    throw validationError("An update field is required");
  if (body.title !== undefined) stringWithin(body.title, "Title", 1, 200);
  if (body.bodyMarkdown !== undefined)
    stringWithin(body.bodyMarkdown, "Body", 1, 100000);
  if (body.anonymous !== undefined && typeof body.anonymous !== "boolean")
    throw validationError("Anonymous is invalid");
  if (body.pinned !== undefined && typeof body.pinned !== "boolean")
    throw validationError("Pinned is invalid");
  if (body.private !== undefined && typeof body.private !== "boolean")
    throw validationError("Private is invalid");
  if (
    body.duplicateOfPostId !== undefined &&
    body.duplicateOfPostId !== null &&
    (typeof body.duplicateOfPostId !== "string" ||
      !UUID_PATTERN.test(body.duplicateOfPostId))
  )
    throw validationError("Duplicate target is invalid");
  if (
    body.duplicateStatus !== undefined &&
    !["none", "suggested", "confirmed"].includes(body.duplicateStatus as string)
  )
    throw validationError("Duplicate status is invalid");
  return { ...body, tags: postTags(body.tags) } as UpdatePost;
}

export function createApp(
  dependencies: AppDependencies = { environment: testEnvironment() },
) {
  const {
    environment,
    authService,
    courseService,
    postService,
    answerService,
    followupService,
    statisticsService,
    courseFileService,
    courseResourceService,
    courseInformationService,
    observability,
    contentAttachmentService,
    collaborationSessionService,
    notificationService,
  } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  if (environment.trustProxyHops === 1) app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set("X-Request-Id", response.locals.requestId);
    next();
  });
  if (observability) app.use(observability.requestMiddleware);
  app.use(express.json({ limit: "128kb" }));
  if (observability) app.get("/metrics", observability.metricsHandler);
  app.get("/health", (_request, response) =>
    response.status(200).json({ status: "ok" }),
  );
  app.options("/api/v1/{*path}", (request, response) => {
    const origin = request.header("origin");
    if (!origin || !environment.frontendOrigins.has(origin))
      return response.sendStatus(403);
    return response
      .set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type,If-Match,Idempotency-Key,X-CSRF-Token",
        Vary: "Origin",
      })
      .sendStatus(204);
  });
  const publicOrigin = originGuard(environment);
  const optionalReadOrigin = safeReadOrigin(environment);
  const service = (): AuthService => {
    if (!authService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Authentication service is unavailable",
      );
    return authService;
  };
  const sourceIp = (request: Request) =>
    request.ip || request.socket.remoteAddress || "unknown";
  const requireSession = async (
    request: Request,
    csrf = false,
  ): Promise<AuthContext> => {
    const credential = cookies(request)[SESSION_COOKIE_NAME];
    if (!credential)
      throw new AuthError(
        401,
        "authentication_required",
        "Authentication is required",
      );
    const csrfToken = csrf ? request.header("x-csrf-token") : undefined;
    if (csrf && !csrfToken)
      throw new AuthError(
        403,
        "csrf_validation_failed",
        "CSRF token is invalid",
      );
    return {
      credential,
      session: await service().session(credential, csrfToken),
    };
  };
  const authenticatedUnsafe = [
    publicOrigin,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.locals.auth = await requireSession(request, true);
        next();
      } catch (error) {
        next(error);
      }
    },
  ];
  const auth = (response: Response) => response.locals.auth as AuthContext;
  const param = (value: string | string[], join = false) => {
    const candidate = Array.isArray(value) ? value[0]! : value;
    if (
      candidate.length >= 1 &&
      candidate.length <= 255 &&
      UUID_PATTERN.test(candidate)
    )
      return candidate;
    if (join)
      throw new AuthError(422, "invalid_join_code", "Join code is invalid");
    throw new AuthError(404, "not_found", "Resource is not found");
  };
  const courseSummary = <T extends { joinCode: unknown }>(value: T) => {
    const copy = { ...value };
    delete copy.joinCode;
    return copy;
  };
  const courses = (): CourseService => {
    if (!courseService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Course service is unavailable",
      );
    return courseService;
  };
  const answers = (): AnswerService => {
    if (!answerService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Answer service is unavailable",
      );
    return answerService;
  };
  const followups = (): FollowupService => {
    if (!followupService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Followup service is unavailable",
      );
    return followupService;
  };
  const posts = (): PostService => {
    if (!postService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Post service is unavailable",
      );
    return postService;
  };
  const statistics = (): StatisticsService => {
    if (!statisticsService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Statistics service is unavailable",
      );
    return statisticsService;
  };
  app.get(
    "/api/v1/courses/:courseId/statistics",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const period = StatisticsService.period(request.query.period);
        const data = await statistics().summary(
          param(request.params.courseId),
          current.session.user.id,
          period,
        );
        response.set("Cache-Control", "private, no-store").json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/statistics/students",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const period = StatisticsService.period(request.query.period);
        const limit = StatisticsService.limit(request.query.limit);
        const result = await statistics().students(
          param(request.params.courseId),
          current.session.user.id,
          period,
          limit,
          request.query.cursor as string | undefined,
        );
        response.set("Cache-Control", "private, no-store").json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  for (const kind of ["daily", "students"] as const) {
    app.get(
      `/api/v1/courses/:courseId/statistics/export/${kind}`,
      optionalReadOrigin,
      async (request, response, next) => {
        try {
          const current = await requireSession(request);
          const period = StatisticsService.period(request.query.period);
          const courseId = param(request.params.courseId);
          const body =
            kind === "daily"
              ? await statistics().exportDaily(
                  courseId,
                  current.session.user.id,
                  period,
                )
              : await statistics().exportStudents(
                  courseId,
                  current.session.user.id,
                  period,
                );
          response
            .set("Cache-Control", "private, no-store")
            .set("X-Content-Type-Options", "nosniff")
            .set(
              "Content-Disposition",
              `attachment; filename="chalktalk-${courseId}-${period}-${kind}.csv"`,
            )
            .type("text/csv; charset=utf-8")
            .send(body);
        } catch (error) {
          next(error);
        }
      },
    );
  }
  app.post(
    "/api/v1/account-verification-requests",
    publicOrigin,
    async (request, response, next) => {
      try {
        const body = verificationRequestBody(request.body);
        const key = request.header("idempotency-key");
        const email = normalizeEmail(body.email);
        await service().requestVerificationIdempotently(
          key,
          body,
          email,
          sourceIp(request),
        );
        response.sendStatus(202);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post("/api/v1/users", publicOrigin, async (request, response, next) => {
    try {
      const body = accountCreationBody(request.body);
      const key = request.header("idempotency-key");
      const result = await service().createUserIdempotently(
        body,
        key,
        body,
        sourceIp(request),
      );
      profileResponse(
        response.set("Location", "/api/v1/users/me"),
        result.user,
        result.status,
      );
    } catch (error) {
      next(error);
    }
  });
  app.post(
    "/api/v1/sessions",
    publicOrigin,
    async (request, response, next) => {
      try {
        const body = sessionCreationBody(request.body);
        const email = normalizeEmail(body.email);
        await service().checkLimit(email, sourceIp(request), "login");
        const result = await service().login(body.email, body.password);
        response
          .status(201)
          .set({
            "Set-Cookie": sessionCookie(result.credential),
            "Cache-Control": "no-store",
          })
          .json({ data: result.session });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/sessions/current",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        response
          .set("Cache-Control", "no-store")
          .json({ data: current.session });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/sessions/current",
    ...authenticatedUnsafe,
    async (_request, response, next) => {
      try {
        await service().logout(auth(response).session.id);
        response.status(204).set("Set-Cookie", sessionCookie("", 0)).send();
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/users/me",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        profileResponse(response, await service().profile(current.credential));
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/users/me",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const body = profileUpdateBody(request.body);
        profileResponse(
          response,
          await service().updateProfile(
            auth(response).credential,
            request.header("if-match"),
            body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/users/me/password",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const body = passwordChangeBody(request.body);
        await service().changePassword(
          auth(response).credential,
          request.header("if-match"),
          body.currentPassword,
          body.newPassword,
        );
        response.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/password-reset-requests",
    publicOrigin,
    async (request, response, next) => {
      try {
        const body = passwordResetRequestBody(request.body);
        const email = normalizeEmail(body.email);
        await service().checkLimit(email, sourceIp(request), "reset");
        await service().requestPasswordReset(body.email);
        response.sendStatus(202);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/password-resets",
    publicOrigin,
    async (request, response, next) => {
      try {
        const body = passwordResetBody(request.body);
        await service().resetPassword(body.token, body.newPassword);
        response.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/users/me",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const body = accountDeletionBody(request.body);
        await service().deleteAccount(
          auth(response).credential,
          request.header("if-match"),
          body.currentPassword,
        );
        response.status(204).set("Set-Cookie", sessionCookie("", 0)).send();
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/organizations",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const options = listQuery(request.query);
        if (options.cursor)
          throw new AuthError(
            400,
            "invalid_request",
            "Pagination cursor is invalid",
          );
        const organizations = await courses().organizations(
          current.session.user.id,
        );
        response.json({
          data: organizations.slice(0, options.limit),
          page: {
            nextCursor: null,
            hasMore: organizations.length > options.limit,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const options = listQuery(request.query, {
          key: "status",
          values: ["active", "archived", "deleting"],
        });
        const result = await courses().listPage(
          current.session.user.id,
          options.filter,
          options.limit,
          options.cursor,
        );
        response.json({
          data: result.data.map(courseSummary),
          page: result.page,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/organizations/:organizationId/courses",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = courseCreateBody(request.body);
        const key = request.header("idempotency-key");
        const result = await courses().createIdempotently(
          param(request.params.organizationId),
          auth(response).session.user.id,
          body.name,
          key,
          body,
        );
        const { value } = result;
        response
          .status(result.status)
          .set({
            Location: `/api/v1/courses/${value.id}`,
            ETag: courseEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/organizations/:organizationId/courses",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const options = listQuery(request.query, {
          key: "status",
          values: ["active", "archived", "deleting"],
        });
        const result = await courses().listOrganizationPage(
          param(request.params.organizationId),
          current.session.user.id,
          options.filter,
          options.limit,
          options.cursor,
        );
        response.json({
          data: result.data.map(courseSummary),
          page: result.page,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await courses().get(
          param(request.params.courseId),
          current.session.user.id,
        );
        response.set("ETag", courseEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = courseUpdateBody(request.body);
        const value = await courses().update(
          param(request.params.courseId),
          auth(response).session.user.id,
          request.header("if-match"),
          body,
        );
        response.set("ETag", courseEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const value = await courses().delete(
          param(request.params.courseId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response
          .status(202)
          .set({
            Location: `/api/v1/courses/${value.id}`,
            ETag: courseEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/members",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = joinCourseBody(request.body);
        const key = request.header("idempotency-key");
        const result = await courses().joinIdempotently(
          param(request.params.courseId, true),
          auth(response).session.user.id,
          body.joinCode,
          key,
          body,
        );
        const { value } = result;
        response
          .status(result.status)
          .set({
            Location: `/api/v1/courses/${value.courseId}/members/${value.user.id}`,
            ETag: courseEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/members",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const options = listQuery(request.query, {
          key: "role",
          values: ["student", "ta", "instructor"],
        });
        const result = await courses().membersPage(
          param(request.params.courseId),
          current.session.user.id,
          options.filter,
          options.limit,
          options.cursor,
        );
        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/members/me/email-preferences",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await courses().getEmailPreferences(
          param(request.params.courseId),
          current.session.user.id,
        );
        response.set("ETag", courseEtag(value)).json({ data: value.data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId/members/me/email-preferences",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = emailPreferencesBody(request.body);
        const value = await courses().updateEmailPreferences(
          param(request.params.courseId),
          auth(response).session.user.id,
          request.header("if-match"),
          body,
        );
        response.set("ETag", courseEtag(value)).json({ data: value.data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/members/:userId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const data = await courses().getMember(
          param(request.params.courseId),
          current.session.user.id,
          param(request.params.userId),
        );
        response.set("ETag", courseEtag(data)).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId/members/:userId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = memberUpdateBody(request.body);
        const data = await courses().updateMember(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.userId),
          request.header("if-match"),
          body.role,
        );
        response.set("ETag", courseEtag(data)).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/members/me",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await courses().removeMember(
          param(request.params.courseId),
          auth(response).session.user.id,
          auth(response).session.user.id,
          undefined,
          true,
        );
        response.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/members/:userId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const requestedUserId = param(request.params.userId);
        const isSelfLeave = requestedUserId === "me";
        await courses().removeMember(
          param(request.params.courseId),
          auth(response).session.user.id,
          isSelfLeave ? auth(response).session.user.id : requestedUserId,
          isSelfLeave ? undefined : request.header("if-match"),
          isSelfLeave,
        );
        response.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );
  const courseFiles = (): CourseFileService => {
    if (!courseFileService)
      throw new AuthError(
        503,
        "service_unavailable",
        "File service is unavailable",
      );
    return courseFileService;
  };
  const contentAttachments = (): ContentAttachmentService => {
    if (!contentAttachmentService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Attachment service is unavailable",
      );
    return contentAttachmentService;
  };
  for (const [kind, route, parameter] of [
    ["post", "/api/v1/posts/:postId/attachments", "postId"],
    ["answer", "/api/v1/answers/:answerId/attachments", "answerId"],
    ["followup", "/api/v1/followups/:followupId/attachments", "followupId"],
  ] as const) {
    app.post(route, ...authenticatedUnsafe, async (request, response, next) => {
      let upload: Awaited<ReturnType<typeof readMultipart>> | undefined;
      try {
        const parentId = param(request.params[parameter]);
        const userId = auth(response).session.user.id;
        await contentAttachments().authorizeUpload(
          kind as ParentKind,
          parentId,
          userId,
          request.header("idempotency-key"),
        );
        upload = await readMultipart(request);
        const value = await contentAttachments().create(
          kind as ParentKind,
          parentId,
          userId,
          upload,
          request.header("idempotency-key"),
        );
        response
          .status(201)
          .set({ Location: value.downloadUrl })
          .json({ data: value });
      } catch (error) {
        next(error);
      } finally {
        await upload?.cleanup();
      }
    });
  }
  app.get(
    "/api/v1/attachments/:attachmentId/download",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const file = await contentAttachments().download(
          param(request.params.attachmentId),
          current.session.user.id,
        );
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        response.set({
          "Content-Type": file.mediaType,
          "Content-Length": String(file.length),
          "Content-Disposition": `${file.mediaType.startsWith("image/") ? "inline" : "attachment"}; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        });
        const body = file.body as NodeJS.ReadableStream;
        body.on("error", (error) => {
          if (!response.headersSent) next(error);
          else response.destroy(error);
        });
        body.pipe(response);
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/attachments/:attachmentId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await contentAttachments().delete(
          param(request.params.attachmentId),
          auth(response).session.user.id,
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  const information = () => {
    if (!courseInformationService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Course information is unavailable",
      );
    return courseInformationService;
  };
  app.get(
    "/api/v1/courses/:courseId/staff",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        response.set("Cache-Control", "private, no-store").json({
          data: await information().staff(
            param(request.params.courseId),
            current.session.user.id,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId/staff/:userId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["contact", "location", "officeHours"],
          ["contact", "location", "officeHours"],
        );
        const value = await information().updateStaff(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.userId),
          {
            contact: body.contact,
            location: body.location,
            officeHours: body.officeHours,
          },
          request.header("if-match"),
        );
        response
          .set({
            ETag: informationEtag(value),
            "Cache-Control": "private, no-store",
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.put(
    "/api/v1/courses/:courseId/information/syllabus",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      let upload: Awaited<ReturnType<typeof readMultipart>> | undefined;
      try {
        const courseId = param(request.params.courseId),
          userId = auth(response).session.user.id;
        await information().checkSyllabusWrite(
          courseId,
          userId,
          request.header("if-match"),
        );
        upload = await readMultipart(request);
        const value = await information().replaceSyllabus(
          courseId,
          userId,
          upload,
          request.header("if-match"),
          courseFiles(),
        );
        response
          .set({
            ETag: informationEtag(value),
            "Cache-Control": "private, no-store",
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      } finally {
        await upload?.cleanup();
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/information/syllabus",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const value = await information().removeSyllabus(
          param(request.params.courseId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response
          .set({
            ETag: informationEtag(value),
            "Cache-Control": "private, no-store",
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/information",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await information().read(
          param(request.params.courseId),
          current.session.user.id,
        );
        response
          .set({
            ETag: informationEtag(value),
            "Cache-Control": "private, no-store",
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId/information",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["descriptionMarkdown", "website"],
          ["descriptionMarkdown", "website"],
        );
        const value = await information().update(
          param(request.params.courseId),
          auth(response).session.user.id,
          {
            descriptionMarkdown: body.descriptionMarkdown,
            website: body.website,
          },
          request.header("if-match"),
        );
        response
          .set({
            ETag: informationEtag(value),
            "Cache-Control": "private, no-store",
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  const catalog = () => {
    if (!courseResourceService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Resources are unavailable",
      );
    return courseResourceService;
  };
  app.patch(
    "/api/v1/courses/:courseId/resource-sections/:sectionId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(request.body, ["title", "visibility"], []);
        const value = await catalog().updateSection(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.sectionId),
          body,
          request.header("if-match"),
        );
        response.set("ETag", resourceEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/resource-sections/:sectionId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await catalog().deleteSection(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.sectionId),
          request.header("if-match"),
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  app.put(
    "/api/v1/courses/:courseId/resource-sections/order",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(request.body, ["ids"], ["ids"]);
        const value = await catalog().reorder(
          param(request.params.courseId),
          auth(response).session.user.id,
          body.ids,
          request.header("if-match"),
        );
        response.set("ETag", resourceEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.put(
    "/api/v1/courses/:courseId/resources/order",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["ids", "sectionId"],
          ["ids", "sectionId"],
        );
        const value = await catalog().reorder(
          param(request.params.courseId),
          auth(response).session.user.id,
          body.ids,
          request.header("if-match"),
          body.sectionId,
        );
        response.set("ETag", resourceEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/courses/:courseId/resources/:resourceId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["title", "visibility", "sectionId", "url"],
          [],
        );
        const value = await catalog().update(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.resourceId),
          body,
          request.header("if-match"),
        );
        response.set("ETag", resourceEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/resources/:resourceId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await catalog().delete(
          param(request.params.courseId),
          auth(response).session.user.id,
          param(request.params.resourceId),
          request.header("if-match"),
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  for (const replace of [false, true])
    app[replace ? "put" : "post"](
      replace
        ? "/api/v1/courses/:courseId/resources/:resourceId/file"
        : "/api/v1/courses/:courseId/resources/files",
      ...authenticatedUnsafe,
      async (request, response, next) => {
        let upload: Awaited<ReturnType<typeof readMultipart>> | undefined;
        try {
          const courseId = param(request.params.courseId),
            userId = auth(response).session.user.id;
          await catalog().authorizeUpload(
            courseId,
            userId,
            request.header("idempotency-key"),
          );
          upload = await readMultipart(request, [
            "title",
            "sectionId",
            "visibility",
          ]);
          const value = await catalog().upload(
            courseId,
            userId,
            upload,
            upload.fields,
            courseFiles(),
            request.header("idempotency-key"),
            replace ? param(request.params.resourceId) : undefined,
            request.header("if-match"),
          );
          response
            .status(replace ? 200 : 201)
            .set({
              ETag: resourceEtag(value),
              Location: `/api/v1/courses/${courseId}/resources/${value.id}`,
            })
            .json({ data: value });
        } catch (error) {
          next(error);
        } finally {
          await upload?.cleanup();
        }
      },
    );
  app.get(
    "/api/v1/courses/:courseId/resource-sections",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await catalog().sections(
          param(request.params.courseId),
          current.session.user.id,
        );
        response
          .set({
            "Cache-Control": "private, no-store",
            ETag: resourceEtag(value),
          })
          .json(value);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/resource-sections",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["title", "visibility"],
          ["title"],
        );
        const value = await catalog().createSection(
          param(request.params.courseId),
          auth(response).session.user.id,
          { title: body.title, visibility: body.visibility },
        );
        response
          .status(201)
          .set({
            ETag: resourceEtag(value),
            Location: `/api/v1/courses/${value.courseId}/resource-sections/${value.id}`,
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/resources/:resourceId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await catalog().read(
          param(request.params.courseId),
          param(request.params.resourceId),
          current.session.user.id,
        );
        response
          .set({
            "Cache-Control": "private, no-store",
            ETag: resourceEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/resources",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        if (
          Object.keys(request.query).some(
            (key) => !["limit", "cursor", "sort", "sectionId"].includes(key),
          ) ||
          (request.query.sort !== undefined &&
            typeof request.query.sort !== "string") ||
          (request.query.sectionId !== undefined &&
            typeof request.query.sectionId !== "string") ||
          (request.query.limit !== undefined &&
            (typeof request.query.limit !== "string" ||
              !/^[1-9]\d*$/.test(request.query.limit)))
        )
          throw new AuthError(400, "invalid_request", "Pagination is invalid");
        const query = listQuery(request.query);
        if (!courseResourceService)
          throw new AuthError(
            503,
            "service_unavailable",
            "Resource service is unavailable",
          );
        const value = await courseResourceService.list(
          param(request.params.courseId),
          current.session.user.id,
          query.limit,
          query.cursor,
          typeof request.query.sort === "string"
            ? request.query.sort
            : undefined,
          typeof request.query.sectionId === "string"
            ? request.query.sectionId
            : undefined,
        );
        response
          .set({
            "Cache-Control": "private, no-store",
            ETag: resourceEtag(value),
          })
          .json(value);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/resources",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["kind", "title", "url", "sectionId", "visibility"],
          ["kind", "title", "url"],
        );
        if (body.kind !== "link")
          throw validationError("Only named links can be created here");
        if (!courseResourceService)
          throw new AuthError(
            503,
            "service_unavailable",
            "Resource service is unavailable",
          );
        const value = await courseResourceService.create(
          param(request.params.courseId),
          auth(response).session.user.id,
          {
            title: body.title,
            url: body.url,
            sectionId: body.sectionId,
            visibility: body.visibility,
          },
          request.header("idempotency-key"),
        );
        response
          .status(201)
          .set({
            Location: `/api/v1/courses/${value.courseId}/resources`,
            ETag: resourceEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/files",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        if (
          Object.keys(request.query).some(
            (key) => key !== "limit" && key !== "cursor",
          ) ||
          (request.query.limit !== undefined &&
            (typeof request.query.limit !== "string" ||
              !/^[1-9]\d*$/.test(request.query.limit)))
        )
          throw new AuthError(400, "invalid_request", "Pagination is invalid");
        const query = listQuery(request.query);
        response
          .set("Cache-Control", "private, no-store")
          .json(
            await courseFiles().list(
              param(request.params.courseId),
              current.session.user.id,
              query.limit,
              query.cursor,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/files",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      let upload: Awaited<ReturnType<typeof readMultipart>> | undefined;
      try {
        await courseFiles().authorizeUpload(
          param(request.params.courseId),
          auth(response).session.user.id,
          request.header("idempotency-key"),
        );
        upload = await readMultipart(request);
        const value = await courseFiles().create(
          param(request.params.courseId),
          auth(response).session.user.id,
          upload,
          request.header("idempotency-key"),
        );
        response
          .status(201)
          .set({
            Location: `/api/v1/courses/${value.courseId}/files/${value.id}/download`,
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      } finally {
        await upload?.cleanup();
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/files/:fileId/download",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const file = await courseFiles().download(
          param(request.params.courseId),
          param(request.params.fileId),
          current.session.user.id,
        );
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        response.set({
          "Content-Type": file.mediaType,
          "Content-Length": String(file.length),
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        });
        const body = file.body as NodeJS.ReadableStream;
        body.on("error", (error) => {
          if (!response.headersSent) next(error);
          else response.destroy(error);
        });
        body.pipe(response);
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/courses/:courseId/files/:fileId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await courseFiles().delete(
          param(request.params.courseId),
          param(request.params.fileId),
          auth(response).session.user.id,
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/posts",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = postCreateBody(request.body);
        const result = await posts().create(
          param(request.params.courseId),
          auth(response).session.user.id,
          body,
          request.header("idempotency-key"),
        );
        response
          .status(result.status)
          .set({
            Location: `/api/v1/posts/${result.value.id}`,
            ETag: postEtag(result.value),
          })
          .json({ data: result.value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/posts",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const options = postListQuery(request.query);
        const result = await posts().list(
          param(request.params.courseId),
          current.session.user.id,
          options,
        );
        response.locals.safeResultCount = result.data.length;
        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/posts/:postId/duplicate-review",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await posts().getDuplicateReview(
          param(request.params.postId),
          current.session.user.id,
        );
        response
          .set({ ETag: postEtag(value), "Cache-Control": "private, no-store" })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/posts/:postId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await posts().get(
          param(request.params.postId),
          current.session.user.id,
        );
        if (value.duplicateStatus === "confirmed") {
          response
            .status(303)
            .set({
              Location: `/api/v1/posts/${value.duplicateOfPostId}`,
              "Cache-Control": "private, no-store",
            })
            .send();
          return;
        }
        // Following and unread are per viewer and change without a new version.
        response
          .set({ ETag: postEtag(value), "Cache-Control": "private, no-store" })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/posts/:postId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = postUpdateBody(request.body);
        const value = await posts().update(
          param(request.params.postId),
          auth(response).session.user.id,
          request.header("if-match"),
          body,
        );
        response.set("ETag", postEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.put(
    "/api/v1/posts/:postId/discussion-lock",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(request.body, ["locked"], ["locked"]);
        if (typeof body.locked !== "boolean")
          throw new AuthError(
            422,
            "validation_failed",
            "Locked must be a boolean",
          );
        const value = await posts().setDiscussionLocked(
          param(request.params.postId),
          auth(response).session.user.id,
          request.header("if-match"),
          body.locked,
        );
        response.set("ETag", postEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/posts/:postId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await posts().delete(
          param(request.params.postId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  for (const [method, following] of [
    ["put", true],
    ["delete", false],
  ] as const)
    app[method](
      "/api/v1/posts/:postId/follow",
      ...authenticatedUnsafe,
      async (request, response, next) => {
        try {
          const value = await posts().setFollowing(
            param(request.params.postId),
            auth(response).session.user.id,
            following,
          );
          response.json({ data: value });
        } catch (error) {
          next(error);
        }
      },
    );
  app.get(
    "/api/v1/courses/:courseId/mention-suggestions",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const { q = "", postId, ...rest } = request.query;
        if (
          Object.keys(rest).length ||
          typeof q !== "string" ||
          q.length > 50 ||
          (postId !== undefined && typeof postId !== "string")
        )
          throw new AuthError(400, "invalid_request", "Query is invalid");
        response.json({
          data: await posts().mentionSuggestions(
            param(request.params.courseId),
            current.session.user.id,
            q,
            postId as string | undefined,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/courses/:courseId/read-marks",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await posts().markCourseRead(
          param(request.params.courseId),
          auth(response).session.user.id,
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  app.put(
    "/api/v1/posts/:postId/vote",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(request.body, ["optionId"], ["optionId"]);
        const value = await posts().vote(
          param(request.params.postId),
          auth(response).session.user.id,
          stringWithin(body.optionId, "Option", 1, 255),
        );
        response.json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/posts/:postId/vote",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await posts().unvote(
          param(request.params.postId),
          auth(response).session.user.id,
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/posts/:postId/answers",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = answerCreateBody(request.body);
        const result = await answers().create(
          param(request.params.postId),
          auth(response).session.user.id,
          body,
          request.header("idempotency-key"),
        );
        response
          .status(result.status)
          .set({
            Location: `/api/v1/answers/${result.value.id}`,
            ETag: answerEtag(result.value),
          })
          .json({ data: result.value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/posts/:postId/answers",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const data = await answers().list(
          param(request.params.postId),
          current.session.user.id,
        );
        response.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/answers/:answerId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await answers().get(
          param(request.params.answerId),
          current.session.user.id,
        );
        response.set("ETag", answerEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/answers/:answerId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["bodyMarkdown"],
          ["bodyMarkdown"],
        );
        const bodyMarkdown = stringWithin(body.bodyMarkdown, "Body", 1, 100000);
        if (!bodyMarkdown.trim()) throw validationError("Body is invalid");
        const value = await answers().edit(
          param(request.params.answerId),
          auth(response).session.user.id,
          request.header("if-match"),
          bodyMarkdown,
        );
        response.set("ETag", answerEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  for (const method of ["put", "delete"] as const) {
    app[method](
      "/api/v1/answers/:answerId/upvote",
      ...authenticatedUnsafe,
      async (request, response, next) => {
        try {
          const value = await answers().upvote(
            param(request.params.answerId),
            auth(response).session.user.id,
            method === "put",
          );
          response.set("ETag", answerEtag(value)).json({ data: value });
        } catch (error) {
          next(error);
        }
      },
    );
  }
  app.get(
    "/api/v1/posts/:postId/followups",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const { cursor, limit } = followupListQuery(request.query);
        const page = await followups().list(
          param(request.params.postId),
          current.session.user.id,
          undefined,
          cursor,
          limit,
        );
        response.json(page);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/posts/:postId/followups",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = answerCreateBody(request.body);
        const value = await followups().create(
          param(request.params.postId),
          auth(response).session.user.id,
          body,
          undefined,
          request.header("idempotency-key"),
        );
        response
          .status(201)
          .set({
            Location: `/api/v1/followups/${value.id}`,
            ETag: followupEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/followups/:followupId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await followups().get(
          param(request.params.followupId),
          current.session.user.id,
        );
        response.set("ETag", followupEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/followups/:followupId/replies",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const { cursor, limit } = followupListQuery(request.query);
        const parent = await followups().get(
          param(request.params.followupId),
          current.session.user.id,
        );
        const page = await followups().list(
          parent.postId,
          current.session.user.id,
          parent.id,
          cursor,
          limit,
        );
        response.json(page);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/followups/:followupId/replies",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const parent = await followups().get(
          param(request.params.followupId),
          auth(response).session.user.id,
        );
        const body = answerCreateBody(request.body);
        const value = await followups().create(
          parent.postId,
          auth(response).session.user.id,
          body,
          parent.id,
          request.header("idempotency-key"),
        );
        response
          .status(201)
          .set({
            Location: `/api/v1/followups/${value.id}`,
            ETag: followupEtag(value),
          })
          .json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/followups/:followupId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["bodyMarkdown"],
          ["bodyMarkdown"],
        );
        const markdown = stringWithin(body.bodyMarkdown, "Body", 1, 100000);
        if (!markdown.trim()) throw validationError("Body is invalid");
        const value = await followups().edit(
          param(request.params.followupId),
          auth(response).session.user.id,
          request.header("if-match"),
          markdown,
        );
        response.set("ETag", followupEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/followups/:followupId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await followups().delete(
          param(request.params.followupId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  for (const method of ["put", "delete"] as const) {
    app[method](
      "/api/v1/followups/:followupId/upvote",
      ...authenticatedUnsafe,
      async (request, response, next) => {
        try {
          const value = await followups().upvote(
            param(request.params.followupId),
            auth(response).session.user.id,
            method === "put",
          );
          response.set("ETag", followupEtag(value)).json({ data: value });
        } catch (error) {
          next(error);
        }
      },
    );
  }
  for (const [method, resolved] of [
    ["put", true],
    ["delete", false],
  ] as const)
    app[method](
      "/api/v1/followups/:followupId/resolution",
      ...authenticatedUnsafe,
      async (request, response, next) => {
        try {
          const value = await followups().setResolved(
            param(request.params.followupId),
            auth(response).session.user.id,
            resolved,
          );
          response.set("ETag", followupEtag(value)).json({ data: value });
        } catch (error) {
          next(error);
        }
      },
    );
  app.put(
    "/api/v1/answers/:answerId/endorsement",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const value = await answers().endorse(
          param(request.params.answerId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response.set("ETag", answerEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/answers/:answerId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await answers().delete(
          param(request.params.answerId),
          auth(response).session.user.id,
          request.header("if-match"),
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  const notifications = (): NotificationService => {
    if (!notificationService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Notification service is unavailable",
      );
    return notificationService;
  };
  app.get(
    "/api/v1/users/me/notifications/unread-count",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        response.json({
          data: await notifications().unreadCount(current.session.user.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/users/me/notifications",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const { limit, cursor } = listQuery(request.query);
        const rawUnread = request.query.unread;
        if (rawUnread !== undefined && rawUnread !== "true")
          throw new AuthError(400, "invalid_request", "Filter is invalid");
        if (
          Object.keys(request.query).some(
            (key) => !["limit", "cursor", "unread"].includes(key),
          )
        )
          throw new AuthError(400, "invalid_request", "Filter is invalid");
        response.json(
          await notifications().list(current.session.user.id, {
            limit,
            cursor,
            unread: rawUnread === "true",
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/users/me/notifications/read",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const empty =
          request.body === undefined ||
          (typeof request.body === "object" &&
            request.body !== null &&
            Object.keys(request.body).length === 0);
        let ids: string[] | undefined;
        if (!empty) {
          requireJsonRequest(request);
          const body = strictBody(request.body, ["ids"], ["ids"]);
          if (
            !Array.isArray(body.ids) ||
            body.ids.some((id) => typeof id !== "string")
          )
            throw validationError("Notification ids are invalid");
          ids = body.ids as string[];
        }
        await notifications().markRead(auth(response).session.user.id, ids);
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  const collaboration = (): CollaborationSessionService => {
    if (!collaborationSessionService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Collaboration service is unavailable",
      );
    return collaborationSessionService;
  };
  app.post(
    "/api/v1/courses/:courseId/collaboration-sessions",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = collaborationCreateBody(request.body);
        const result = await collaboration().create(
          param(request.params.courseId),
          auth(response).session.user.id,
          body,
          request.header("idempotency-key"),
        );
        response
          .status(result.status)
          .set({
            Location: `/api/v1/collaboration-sessions/${result.value.id}`,
            ETag: collaborationEtag(result.value),
          })
          .json({ data: result.value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/courses/:courseId/collaboration-sessions",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const result = await collaboration().list(
          param(request.params.courseId),
          current.session.user.id,
          collaborationListQuery(request.query),
        );
        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/users/me/collaboration-sessions",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const { limit, cursor, filter } = listQuery(request.query, {
          key: "status",
          values: ["active", "ended"],
        });
        const result = await collaboration().listForUser(
          current.session.user.id,
          { limit, cursor, status: filter as "active" | "ended" | undefined },
        );
        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/collaboration-sessions/:sessionId",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const value = await collaboration().get(
          param(request.params.sessionId),
          current.session.user.id,
        );
        response.set("ETag", collaborationEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.patch(
    "/api/v1/collaboration-sessions/:sessionId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = collaborationUpdateBody(request.body);
        const value = await collaboration().update(
          param(request.params.sessionId),
          auth(response).session.user.id,
          request.header("if-match"),
          body,
        );
        response.set("ETag", collaborationEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/collaboration-sessions/:sessionId/participants",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        requireJsonRequest(request);
        const body = strictBody(
          request.body,
          ["userId", "permission"],
          ["userId"],
        );
        if (
          body.permission !== undefined &&
          body.permission !== "edit" &&
          body.permission !== "view"
        )
          throw new AuthError(
            422,
            "validation_failed",
            "Permission must be edit or view",
          );
        const value = await collaboration().invite(
          param(request.params.sessionId),
          auth(response).session.user.id,
          stringWithin(body.userId, "User", 1, 255),
          body.permission as "edit" | "view" | undefined,
        );
        response.set("ETag", collaborationEtag(value)).json({ data: value });
      } catch (error) {
        next(error);
      }
    },
  );
  app.delete(
    "/api/v1/collaboration-sessions/:sessionId/participants/:userId",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        await collaboration().remove(
          param(request.params.sessionId),
          auth(response).session.user.id,
          param(request.params.userId),
        );
        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/v1/collaboration-sessions/:sessionId/connection-tickets",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        const current = auth(response).session;
        const data = await collaboration().ticket(
          param(request.params.sessionId),
          current.user.id,
          current.id,
        );
        response.status(201).set("Cache-Control", "no-store").json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    "/api/v1/collaboration-sessions/:sessionId/snapshot",
    optionalReadOrigin,
    async (request, response, next) => {
      try {
        const current = await requireSession(request);
        const data = await collaboration().snapshot(
          param(request.params.sessionId),
          current.session.user.id,
        );
        response.set("Cache-Control", "no-store").json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      void next;
      const authError =
        error instanceof AuthError
          ? error
          : error instanceof SyntaxError &&
              typeof error === "object" &&
              "type" in error &&
              error.type === "entity.parse.failed"
            ? new AuthError(400, "invalid_request", "Request body is invalid")
            : new AuthError(
                500,
                "internal_error",
                "An unexpected error occurred",
              );
      if ("retryAfter" in authError)
        response.set(
          "Retry-After",
          String((authError as AuthError & { retryAfter: number }).retryAfter),
        );
      response.locals.errorCode = authError.code;
      if (authError.code === "internal_error")
        logUnexpectedError(observability, authError.code);
      response.status(authError.status).json({
        error: {
          code: authError.code,
          message: authError.message,
          requestId: response.locals.requestId,
          details: [],
        },
      });
    },
  );
  return app;
}
