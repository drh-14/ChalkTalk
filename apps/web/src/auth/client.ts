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

async function requestDetailed<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
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
  return { data: payload?.data as T, response };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestDetailed<T>(path, init)).data;
}

function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
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

export type VersionedProfile = { data: User; etag: string };

async function profileRequest(init?: RequestInit): Promise<VersionedProfile> {
  const result = await requestDetailed<User>("/users/me", init);
  const etag = result.response.headers.get("ETag");
  if (!etag)
    throw new Error("The account response did not include a revision.");
  return { data: result.data, etag };
}

export function getProfile(): Promise<VersionedProfile> {
  return profileRequest();
}

export function updateDisplayName(
  displayName: string,
  etag: string,
  csrfToken: string,
): Promise<VersionedProfile> {
  return profileRequest(
    jsonRequest(
      "PATCH",
      { displayName },
      {
        "If-Match": etag,
        "X-CSRF-Token": csrfToken,
      },
    ),
  );
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  etag: string,
  csrfToken: string,
): Promise<void> {
  return request<void>(
    "/users/me/password",
    jsonRequest(
      "PATCH",
      { currentPassword, newPassword },
      {
        "If-Match": etag,
        "X-CSRF-Token": csrfToken,
      },
    ),
  );
}

export function deleteAccount(
  currentPassword: string,
  etag: string,
  csrfToken: string,
): Promise<void> {
  return request<void>(
    "/users/me",
    jsonRequest(
      "DELETE",
      { currentPassword },
      {
        "If-Match": etag,
        "X-CSRF-Token": csrfToken,
      },
    ),
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
