import { useState, type ChangeEvent } from "react";
import {
  uploadAttachment,
  type Attachment,
  type AttachmentParent,
} from "./client.js";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const ATTACHMENT_ACCEPT =
  ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.pptx";
type PendingFile = { file: File; key: string; error: string | null };
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "File operation failed. Please try again.";

export function useAttachmentQueue() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [selectionError, setSelectionError] = useState("");
  function select(
    event: ChangeEvent<HTMLInputElement>,
    existingCount = uploadedCount,
  ) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosen.length) return;
    if (existingCount + files.length + chosen.length > MAX_ATTACHMENTS) {
      setSelectionError("A post or response can have at most five files.");
      return;
    }
    if (chosen.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
      setSelectionError("Each file must be 100 MiB or smaller.");
      return;
    }
    setSelectionError("");
    setFiles((current) => [
      ...current,
      ...chosen.map((file) => ({
        file,
        key: crypto.randomUUID(),
        error: null,
      })),
    ]);
  }
  function remove(key: string) {
    setFiles((current) => current.filter((item) => item.key !== key));
  }
  async function upload(
    kind: AttachmentParent,
    parentId: string,
    csrfToken: string,
    onUploaded?: (attachment: Attachment) => void | Promise<void>,
  ): Promise<boolean> {
    let allSucceeded = true;
    for (const item of files) {
      try {
        const created = await uploadAttachment(
          kind,
          parentId,
          item.file,
          csrfToken,
          item.key,
        );
        await onUploaded?.(created);
        setUploadedCount((count) => count + 1);
        setFiles((current) =>
          current.filter((entry) => entry.key !== item.key),
        );
      } catch (error) {
        allSucceeded = false;
        setFiles((current) =>
          current.map((entry) =>
            entry.key === item.key
              ? { ...entry, error: message(error) }
              : entry,
          ),
        );
      }
    }
    return allSucceeded;
  }
  return { files, uploadedCount, selectionError, select, remove, upload };
}
