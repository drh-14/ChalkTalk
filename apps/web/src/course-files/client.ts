import { ApiError } from "../auth/client.js";
export type Section = {
  id: string;
  courseId: string;
  title: string;
  visibility: "class" | "staff";
  position: number;
  version: number;
};
export type Resource = {
  id: string;
  courseId: string;
  kind: "upload" | "link";
  title: string;
  sectionId: string | null;
  visibility: "class" | "staff";
  position: number;
  version: number;
  createdAt: string;
  url?: string;
  fileId?: string;
  fileName?: string;
  mediaType?: string;
  sizeBytes?: number;
};
export type CatalogPage = {
  data: Resource[];
  page: { hasMore: boolean; nextCursor: string | null };
  version: number;
};
const base = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}`;
async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code ?? "request_failed",
      data.error?.message ?? "Resources are unavailable. Please try again.",
    );
  return data as T;
}
export const sections = (id: string, signal?: AbortSignal) =>
  send<{ data: Section[]; version: number }>(`${base(id)}/resource-sections`, {
    signal,
  });
export const list = (
  id: string,
  sort: string,
  cursor?: string,
  signal?: AbortSignal,
) => {
  const q = new URLSearchParams({ limit: "25" });
  if (sort !== "manual") q.set("sort", sort);
  if (cursor) q.set("cursor", cursor);
  return send<CatalogPage>(`${base(id)}/resources?${q}`, { signal });
};
export async function mutate<T>(
  id: string,
  path: string,
  method: string,
  body: unknown,
  csrf: string,
  version?: number,
  key?: string,
) {
  const result = await send<{ data: T }>(`${base(id)}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...(version ? { "If-Match": `"v${version}"` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  return result?.data;
}
export async function upload(
  id: string,
  file: File,
  metadata: { title: string; sectionId: string | null; visibility: string },
  csrf: string,
  key: string,
  resource?: Resource,
) {
  const body = new FormData();
  body.append("file", file);
  body.append("title", metadata.title || file.name);
  body.append("sectionId", metadata.sectionId ?? "");
  body.append("visibility", metadata.visibility);
  const result = await send<{ data: Resource }>(
    `${base(id)}/resources/${resource ? `${encodeURIComponent(resource.id)}/file` : "files"}`,
    {
      method: resource ? "PUT" : "POST",
      headers: {
        "X-CSRF-Token": csrf,
        "Idempotency-Key": key,
        ...(resource ? { "If-Match": `"v${resource.version}"` } : {}),
      },
      body,
    },
  );
  return result.data;
}
export const filePath = (courseId: string, item: Resource) =>
  `${base(courseId)}/files/${encodeURIComponent(item.fileId ?? item.id)}/download`;

export type CourseFile = {
  id: string;
  courseId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
};
export const downloadPath = (courseId: string, fileId: string) =>
  `${base(courseId)}/files/${encodeURIComponent(fileId)}/download`;
