import { ApiError } from "../auth/client.js";
import type { CourseFile } from "../course-files/client.js";
export type Information = {
  courseId: string;
  descriptionMarkdown: string;
  website: string | null;
  syllabus: CourseFile | null;
  version: number;
};
export type Staff = {
  userId: string;
  displayName: string;
  role: "ta" | "instructor";
  contact: string;
  location: string;
  officeHours: string;
  version: number;
};
const base = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}`;
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error?.code ?? "request_failed",
      value.error?.message ?? "Course information is unavailable",
    );
  return value.data as T;
}
const headers = (csrf: string, version: number) => ({
  "X-CSRF-Token": csrf,
  "If-Match": `"v${version}"`,
});
export const readInformation = (courseId: string, signal?: AbortSignal) =>
  call<Information>(`${base(courseId)}/information`, { signal });
export const readStaff = (courseId: string, signal?: AbortSignal) =>
  call<Staff[]>(`${base(courseId)}/staff`, { signal });
export const saveInformation = (
  courseId: string,
  body: { descriptionMarkdown: string; website: string | null },
  csrf: string,
  version: number,
) =>
  call<Information>(`${base(courseId)}/information`, {
    method: "PATCH",
    headers: { ...headers(csrf, version), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const saveStaff = (
  courseId: string,
  userId: string,
  body: { contact: string; location: string; officeHours: string },
  csrf: string,
  version: number,
) =>
  call<Staff>(`${base(courseId)}/staff/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...headers(csrf, version), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const replaceSyllabus = (
  courseId: string,
  file: File,
  csrf: string,
  version: number,
) => {
  const body = new FormData();
  body.append("file", file);
  return call<Information>(`${base(courseId)}/information/syllabus`, {
    method: "PUT",
    headers: headers(csrf, version),
    body,
  });
};
export const removeSyllabus = (
  courseId: string,
  csrf: string,
  version: number,
) =>
  call<Information>(`${base(courseId)}/information/syllabus`, {
    method: "DELETE",
    headers: headers(csrf, version),
  });
