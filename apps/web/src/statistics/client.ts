import { ApiError } from "../auth/client.js";

export type Period = "7d" | "30d" | "course_to_date";
export type DailyActivity = {
  date: string;
  questionsCreated: number;
  answersCreated: number;
  postsViewed: number;
};
export type Summary = {
  courseId: string;
  period: Period;
  dailyActivity: DailyActivity[];
  postsViewed: number;
  averageResponseTimeSeconds: number | null;
  generatedAt: string;
};
export type StudentRow = {
  user: { id: string; displayName: string };
  questionsCreated: number;
  answersContributed: number;
  postsViewed: number;
};
export type StudentPage = {
  data: StudentRow[];
  page: { hasMore: boolean; nextCursor: string | null };
};

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json()) as {
    data?: T;
    page?: StudentPage["page"];
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Statistics are unavailable.",
    );
  return body as T;
}
export async function getSummary(
  courseId: string,
  period: Period,
): Promise<Summary> {
  const result = await get<{ data: Summary }>(
    `/courses/${encodeURIComponent(courseId)}/statistics?period=${period}`,
  );
  return result.data;
}
export function getStudents(
  courseId: string,
  period: Period,
  cursor?: string,
): Promise<StudentPage> {
  const query = new URLSearchParams({ period });
  if (cursor) query.set("cursor", cursor);
  return get<StudentPage>(
    `/courses/${encodeURIComponent(courseId)}/statistics/students?${query}`,
  );
}

export async function downloadStatisticsCsv(
  courseId: string,
  period: Period,
  kind: "daily" | "students",
  isCurrent: () => boolean,
): Promise<void> {
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/statistics/export/${kind}?period=${period}`,
    { credentials: "include", headers: { Accept: "text/csv" } },
  );
  if (!response.ok) {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Export unavailable.",
    );
  }
  const blob = await response.blob();
  if (!isCurrent()) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chalktalk-${courseId}-${period}-${kind}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
