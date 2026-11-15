import { ApiError } from "../auth/client.js";
import type { Resource } from "../course-files/client.js";
import type { AnchorBox } from "../posts/client.js";

/** An anchored post on a PDF's current file, as the viewer lists it. */
export type ResourceQuestion = {
  id: string;
  type: "question" | "note";
  title: string;
  page: number;
  box: AnchorBox;
  answered?: boolean;
  unresolvedFollowups?: number;
  unread: boolean;
  createdAt: string;
};
export type ResourceQuestions = {
  resourceId: string;
  /** The resource's current file, which new anchors must name. */
  fileId: string;
  data: ResourceQuestion[];
  earlierVersionCount: number;
};

const base = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}`;

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? "These slides are unavailable. Please try again.",
    );
  return body as T;
}

export const getResource = (
  courseId: string,
  resourceId: string,
  signal?: AbortSignal,
) =>
  read<{ data: Resource }>(
    `${base(courseId)}/resources/${encodeURIComponent(resourceId)}`,
    signal,
  ).then((body) => body.data);

export const listResourceQuestions = (
  courseId: string,
  resourceId: string,
  signal?: AbortSignal,
) =>
  read<ResourceQuestions>(
    `${base(courseId)}/resources/${encodeURIComponent(resourceId)}/questions`,
    signal,
  );

export const viewerPath = (
  courseId: string,
  resourceId: string,
  page?: number,
  postId?: string,
) => {
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (postId) params.set("post", postId);
  const query = params.size ? `?${params}` : "";
  return `/courses/${encodeURIComponent(courseId)}/resources/${encodeURIComponent(resourceId)}/view${query}`;
};

export const isPdf = (resource: Pick<Resource, "kind" | "mediaType">) =>
  resource.kind === "upload" && resource.mediaType === "application/pdf";
