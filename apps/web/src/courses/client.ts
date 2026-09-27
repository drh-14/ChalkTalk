import { ApiError } from "../auth/client.js";

const apiBase = "/api/v1";

export type Course = {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "archived" | "deleting";
  joinCode: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Membership = {
  id: string;
  courseId: string;
  user: { id: string; displayName: string };
  role: "student" | "ta" | "instructor";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Page<T> = {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
};

export type Versioned<T> = { data: T; etag: string };

type ErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

const newIdempotencyKey = () => crypto.randomUUID();

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; etag: string }> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson
    ? ((await response.json()) as ErrorEnvelope & {
        data?: T;
        page?: Page<T>["page"];
      })
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
  return { data: payload?.data as T, etag: response.headers.get("etag") ?? "" };
}

function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  body: object | undefined,
  headers: HeadersInit,
): RequestInit {
  return {
    method,
    headers: body
      ? { "Content-Type": "application/json", ...headers }
      : headers,
    body: body ? JSON.stringify(body) : undefined,
  };
}

export async function listCourses(cursor?: string): Promise<Page<Course>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${apiBase}/courses${query}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as ErrorEnvelope & Page<Course>;
  if (!response.ok) {
    const error = payload.error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "Something went wrong. Please try again.",
      error?.requestId,
    );
  }
  return { data: payload.data, page: payload.page };
}

export async function listOrganizations(): Promise<Organization[]> {
  const response = await request<Organization[]>("/organizations");
  return response.data;
}

export async function createCourse(
  organizationId: string,
  name: string,
  csrfToken: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<Versioned<Course>> {
  return request<Course>(
    `/organizations/${organizationId}/courses`,
    jsonRequest(
      "POST",
      { name },
      {
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
    ),
  );
}

export function getCourse(courseId: string): Promise<Versioned<Course>> {
  return request<Course>(`/courses/${courseId}`);
}

export async function joinCourse(
  courseId: string,
  joinCode: string,
  csrfToken: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<Versioned<Membership>> {
  return request<Membership>(
    `/courses/${courseId}/members`,
    jsonRequest(
      "POST",
      { joinCode },
      {
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
    ),
  );
}

export async function listMembers(
  courseId: string,
  cursor?: string,
): Promise<Page<Membership>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `${apiBase}/courses/${courseId}/members${query}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const payload = (await response.json()) as ErrorEnvelope & Page<Membership>;
  if (!response.ok) {
    const error = payload.error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "Something went wrong. Please try again.",
      error?.requestId,
    );
  }
  return { data: payload.data, page: payload.page };
}

export function getMembership(
  courseId: string,
  userId: string,
): Promise<Versioned<Membership>> {
  return request<Membership>(`/courses/${courseId}/members/${userId}`);
}

export function updateCourse(
  courseId: string,
  input: { name?: string; status?: "active" | "archived" },
  csrfToken: string,
  etag: string,
): Promise<Versioned<Course>> {
  return request<Course>(
    `/courses/${courseId}`,
    jsonRequest("PATCH", input, {
      "X-CSRF-Token": csrfToken,
      "If-Match": etag,
    }),
  );
}

export function deleteCourse(
  courseId: string,
  csrfToken: string,
  etag: string,
): Promise<Versioned<Course>> {
  return request<Course>(
    `/courses/${courseId}`,
    jsonRequest("DELETE", undefined, {
      "X-CSRF-Token": csrfToken,
      "If-Match": etag,
    }),
  );
}

export function updateMembership(
  courseId: string,
  userId: string,
  role: Membership["role"],
  csrfToken: string,
  etag: string,
): Promise<Versioned<Membership>> {
  return request<Membership>(
    `/courses/${courseId}/members/${userId}`,
    jsonRequest(
      "PATCH",
      { role },
      {
        "X-CSRF-Token": csrfToken,
        "If-Match": etag,
      },
    ),
  );
}

export async function removeMembership(
  courseId: string,
  userId: string,
  csrfToken: string,
  etag: string,
): Promise<void> {
  await request<void>(
    `/courses/${courseId}/members/${userId}`,
    jsonRequest("DELETE", undefined, {
      "X-CSRF-Token": csrfToken,
      "If-Match": etag,
    }),
  );
}

export async function leaveCourse(
  courseId: string,
  csrfToken: string,
): Promise<void> {
  await request<void>(
    `/courses/${courseId}/members/me`,
    jsonRequest("DELETE", undefined, { "X-CSRF-Token": csrfToken }),
  );
}
