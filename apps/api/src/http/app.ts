import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { SESSION_COOKIE_NAME, sessionCookie } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import { AuthService, type UserProfile, userEtag } from "../auth/service.js";
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

export function createApp(
  dependencies: AppDependencies = { environment: testEnvironment() },
) {
  const { environment, authService } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set("X-Request-Id", response.locals.requestId);
    next();
  });
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
    return {
      credential,
      session: await service().session(
        credential,
        csrf ? request.header("x-csrf-token") : undefined,
      ),
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
        const key = request.header("idempotency-key");
        const replay = await service().getIdempotentResponse(
          "verification",
          key,
          request.body,
        );
        if (replay) {
          response.sendStatus(replay.status);
          return;
        }
        const email =
          typeof request.body?.email === "string"
            ? request.body.email.trim().toLowerCase()
            : undefined;
        await service().checkLimit(
          "verification",
          email,
          sourceIp(request),
          "verification",
        );
        await service().requestVerification(request.body?.email);
        await service().saveIdempotentResponse(
          "verification",
          key,
          request.body,
          202,
          null,
        );
        response.sendStatus(202);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post("/api/v1/users", publicOrigin, async (request, response, next) => {
    try {
      const key = request.header("idempotency-key");
      const replay = await service().getIdempotentResponse(
        "user",
        key,
        request.body,
      );
      if (replay) {
        profileResponse(
          response.set("Location", "/api/v1/users/me"),
          replay.body as UserProfile,
          replay.status,
        );
        return;
      }
      await service().checkLimit(
        "signup",
        undefined,
        sourceIp(request),
        "signup",
      );
      const user = await service().createUser(request.body ?? {});
      await service().saveIdempotentResponse(
        "user",
        key,
        request.body,
        201,
        user,
      );
      profileResponse(response.set("Location", "/api/v1/users/me"), user, 201);
    } catch (error) {
      next(error);
    }
  });
  app.post(
    "/api/v1/sessions",
    publicOrigin,
    async (request, response, next) => {
      try {
        const email =
          typeof request.body?.email === "string"
            ? request.body.email.trim().toLowerCase()
            : undefined;
        await service().checkLimit("login", email, sourceIp(request), "login");
        const result = await service().login(
          request.body?.email,
          request.body?.password,
        );
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
  app.get("/api/v1/sessions/current", async (request, response, next) => {
    try {
      const current = await requireSession(request);
      response.set("Cache-Control", "no-store").json({ data: current.session });
    } catch (error) {
      next(error);
    }
  });
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
  app.get("/api/v1/users/me", async (request, response, next) => {
    try {
      const current = await requireSession(request);
      profileResponse(response, await service().profile(current.credential));
    } catch (error) {
      next(error);
    }
  });
  app.patch(
    "/api/v1/users/me",
    ...authenticatedUnsafe,
    async (request, response, next) => {
      try {
        profileResponse(
          response,
          await service().updateProfile(
            auth(response).credential,
            request.header("if-match"),
            request.body ?? {},
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
        await service().changePassword(
          auth(response).credential,
          request.header("if-match"),
          request.body?.currentPassword,
          request.body?.newPassword,
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
        const email =
          typeof request.body?.email === "string"
            ? request.body.email.trim().toLowerCase()
            : undefined;
        await service().checkLimit("reset", email, sourceIp(request), "reset");
        await service().requestPasswordReset(request.body?.email);
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
        await service().resetPassword(
          request.body?.token,
          request.body?.newPassword,
        );
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
        await service().deleteAccount(
          auth(response).credential,
          request.header("if-match"),
          request.body?.currentPassword,
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
          : new AuthError(
              503,
              "service_unavailable",
              "A required service is temporarily unavailable",
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
