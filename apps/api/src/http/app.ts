import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { SESSION_COOKIE_NAME, sessionCookie } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import {
  AuthService,
  normalizeEmail,
  type UserProfile,
  userEtag,
} from "../auth/service.js";
import type { Environment } from "../config/environment.js";

export interface AppDependencies {
  environment: Environment;
  authService?: AuthService;
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

export function createApp(
  dependencies: AppDependencies = { environment: testEnvironment() },
) {
  const { environment, authService } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set("X-Request-Id", response.locals.requestId);
    next();
  });
  app.use(express.json({ limit: "32kb" }));
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
