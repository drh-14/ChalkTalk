import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";

export type CourseFile = {
  id: string;
  courseId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
};
export type ResourceLink = {
  kind: "link";
  id: string;
  courseId: string;
  title: string;
  url: string;
  createdAt: string;
};
export type CourseResource = ({ kind: "upload" } & CourseFile) | ResourceLink;
const resourcesPath = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}/resources`;
const path = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}/files`;
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Files are unavailable. Please try again.",
    );
  return body as T;
}
export function listResources(
  courseId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<Page<CourseResource>> {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return fetch(`${resourcesPath(courseId)}?${query}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  }).then(read<Page<CourseResource>>);
}
export async function uploadFile(
  courseId: string,
  file: File,
  csrfToken: string,
  key: string,
): Promise<CourseFile> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(path(courseId), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": key,
    },
    body,
  });
  return (await read<{ data: CourseFile }>(response)).data;
}
export function downloadPath(courseId: string, fileId: string) {
  return `${path(courseId)}/${encodeURIComponent(fileId)}/download`;
}

export async function createLink(
  courseId: string,
  title: string,
  url: string,
  csrfToken: string,
  key: string,
): Promise<ResourceLink> {
  return (
    await read<{ data: ResourceLink }>(
      await fetch(resourcesPath(courseId), {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ kind: "link", title, url }),
      }),
    )
  ).data;
}
