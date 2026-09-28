import { randomUUID } from "node:crypto";
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

export interface AppDependencies {
  environment: Environment;
  authService?: AuthService;
  courseService?: CourseService;
  postService?: PostService;
  answerService?: AnswerService;
}
type AuthContext = {
  credential: string;
  session: Awaited<ReturnType<AuthService["session"]>>;
};

function testEnvironment(): Environment {
  return {
    databaseUrl: undefined,
    port: 3000,
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
) {
  const rawLimit = query.limit;
  const limit =
    rawLimit === undefined
      ? 25
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
  const body = strictBody(input, ["name", "status"]);
  if (body.name === undefined && body.status === undefined)
    throw validationError();
  if (body.name !== undefined) stringWithin(body.name, "Course name", 1, 200);
  if (
    body.status !== undefined &&
    body.status !== "active" &&
    body.status !== "archived"
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
function postCreateBody(value: unknown): CreatePost {
  const body = strictBody(
    value,
    ["type", "title", "bodyMarkdown", "anonymous", "tags"],
    ["type", "title", "bodyMarkdown"],
  );
  if (body.type !== "question" && body.type !== "note")
    throw validationError("Post type is invalid");
  const title = stringWithin(body.title, "Title", 1, 200);
  const bodyMarkdown = stringWithin(body.bodyMarkdown, "Body", 1, 100000);
  if (body.anonymous !== undefined && typeof body.anonymous !== "boolean")
    throw validationError("Anonymous is invalid");
  return {
    type: body.type,
    title,
    bodyMarkdown,
    anonymous: body.anonymous as boolean | undefined,
    tags: postTags(body.tags),
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
    "type",
    "tag",
    "authorId",
    "createdAfter",
    "createdBefore",
    "answered",
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
  const type = one("type");
  if (type !== undefined && type !== "question" && type !== "note")
    throw new AuthError(400, "invalid_request", "Type is invalid");
  const rawTags =
    query.tag === undefined
      ? []
      : Array.isArray(query.tag)
        ? query.tag
        : [query.tag];
  if (
    rawTags.some(
      (tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40,
    )
  )
    throw new AuthError(400, "invalid_request", "Tag is invalid");
  const tags = [
    ...new Set((rawTags as string[]).map((tag) => tag.trim().toLowerCase())),
  ];
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
  const duplicateStatus = one("duplicateStatus");
  if (
    duplicateStatus !== undefined &&
    !["none", "suggested", "confirmed"].includes(duplicateStatus)
  )
    throw new AuthError(400, "invalid_request", "Duplicate status is invalid");
  const sort = one("sort") ?? (q ? "relevance" : "recent_activity");
  if (
    !["relevance", "newest", "recent_activity"].includes(sort) ||
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
    type: type as ListPosts["type"],
    tags,
    authorId,
    createdAfter,
    createdBefore,
    answered: rawAnswered === undefined ? undefined : rawAnswered === "true",
    duplicateStatus: duplicateStatus as ListPosts["duplicateStatus"],
    sort: sort as ListPosts["sort"],
    limit,
    cursor,
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
  } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set("X-Request-Id", response.locals.requestId);
    next();
  });
  app.use(express.json({ limit: "128kb" }));
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
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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
  const posts = (): PostService => {
    if (!postService)
      throw new AuthError(
        503,
        "service_unavailable",
        "Post service is unavailable",
      );
    return postService;
  };
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
        response.set("ETag", postEtag(value)).json({ data: value });
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
