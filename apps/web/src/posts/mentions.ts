import { createContext } from "react";
import { ApiError } from "../auth/client.js";

export type MentionSuggestion = {
  userId: string;
  displayName: string;
  role: "student" | "ta" | "instructor";
};
/** Looks up members to suggest for a partial name typed after `@`. */
export type MentionSource = (query: string) => Promise<MentionSuggestion[]>;

/** Markdown editors offer @mentions when a source is provided. */
export const MentionContext = createContext<MentionSource | undefined>(
  undefined,
);

export async function mentionSuggestions(
  courseId: string,
  query: string,
  postId?: string,
): Promise<MentionSuggestion[]> {
  const params = new URLSearchParams({ q: query });
  if (postId) params.set("postId", postId);
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/mention-suggestions?${params}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  const payload = (await response.json()) as {
    data?: MentionSuggestion[];
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Something went wrong. Please try again.",
      payload.error?.requestId,
    );
  return payload.data ?? [];
}

const ROLE_LABELS = { student: "Student", ta: "TA", instructor: "Instructor" };

/** The editor's completion options: @staff first, then matching members. */
export function mentionOptions(query: string, members: MentionSuggestion[]) {
  return [
    ...("staff".startsWith(query.toLowerCase())
      ? [
          {
            label: "@staff",
            detail: "All TAs and instructors",
            apply: "@staff ",
          },
        ]
      : []),
    ...members.map((member) => ({
      label: `@${member.displayName}`,
      detail: ROLE_LABELS[member.role],
      // Brackets would end the link text early, so they are dropped from labels.
      apply: `[@${member.displayName.replace(/[[\]]/g, "")}](mention:${member.userId}) `,
    })),
  ];
}
