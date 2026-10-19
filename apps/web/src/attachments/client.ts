import { ApiError } from "../auth/client.js";

export type Attachment = {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
};
export type AttachmentParent = "post" | "answer" | "followup";

export async function uploadAttachment(
  kind: AttachmentParent,
  parentId: string,
  file: File,
  csrfToken: string,
  idempotencyKey: string,
): Promise<Attachment> {
  const form = new FormData();
  form.set("file", file);
  const section =
    kind === "post" ? "posts" : kind === "answer" ? "answers" : "followups";
  const response = await fetch(
    `/api/v1/${section}/${encodeURIComponent(parentId)}/attachments`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: form,
    },
  );
  const payload = (await response.json()) as {
    data?: Attachment;
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Could not upload this file.",
      payload.error?.requestId,
    );
  if (!payload.data) throw new Error("Upload response is invalid");
  return payload.data;
}

export async function deleteAttachment(
  id: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/attachments/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    },
  );
  if (response.status === 204) return;
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string; requestId?: string };
  };
  throw new ApiError(
    response.status,
    payload.error?.code ?? "request_failed",
    payload.error?.message ?? "Could not remove this file.",
    payload.error?.requestId,
  );
}
