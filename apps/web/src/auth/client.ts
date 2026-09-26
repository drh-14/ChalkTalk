const apiBase = "/api/v1";

export type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Session = {
  id: string;
  user: User;
  expiresAt: string;
  csrfToken: string;
};

export type CreateAccountInput = {
  verificationToken: string;
  password: string;
  displayName: string;
};

type ErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson
    ? ((await response.json()) as ErrorEnvelope & { data?: T })
    : undefined;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "Something went wrong. Please try again.",
      error?.requestId,
    );
  }
  return payload?.data as T;
}

function jsonRequest(
  method: "POST" | "DELETE",
  body?: object,
  headers?: HeadersInit,
): RequestInit {
  return {
    method,
    headers: body
      ? { "Content-Type": "application/json", ...headers }
      : headers,
    body: body ? JSON.stringify(body) : undefined,
  };
}

export function requestVerification(
  email: string,
  idempotencyKey = newIdempotencyKey(),
): Promise<void> {
  return request<void>(
    "/account-verification-requests",
    jsonRequest("POST", { email }, { "Idempotency-Key": idempotencyKey }),
  );
}

export function createAccount(
  input: CreateAccountInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<User> {
  return request<User>(
    "/users",
    jsonRequest("POST", input, { "Idempotency-Key": idempotencyKey }),
  );
}

export function login(email: string, password: string): Promise<Session> {
  return request<Session>(
    "/sessions",
    jsonRequest("POST", { email, password }),
  );
}

export function currentSession(): Promise<Session> {
  return request<Session>("/sessions/current");
}

export function logout(csrfToken: string): Promise<void> {
  return request<void>(
    "/sessions/current",
    jsonRequest("DELETE", undefined, { "X-CSRF-Token": csrfToken }),
  );
}

export function requestPasswordReset(email: string): Promise<void> {
  return request<void>(
    "/password-reset-requests",
    jsonRequest("POST", { email }),
  );
}

export function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  return request<void>(
    "/password-resets",
    jsonRequest("POST", { token, newPassword }),
  );
}
