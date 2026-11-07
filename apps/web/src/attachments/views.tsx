import { useState } from "react";
import {
  deleteAttachment,
  type Attachment,
  type AttachmentParent,
} from "./client.js";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  useAttachmentQueue,
} from "./queue.js";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "File operation failed. Please try again.";

export function AttachmentSelection({
  queue,
  existingCount,
  allowMore = true,
  disabled = false,
}: {
  queue: ReturnType<typeof useAttachmentQueue>;
  existingCount?: number;
  allowMore?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="attachment-selection">
      {allowMore &&
        (existingCount ?? queue.uploadedCount) + queue.files.length <
          MAX_ATTACHMENTS && (
          <label className="attachment-picker">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            Add files
            <input
              type="file"
              aria-label="Add files"
              accept={ATTACHMENT_ACCEPT}
              multiple
              disabled={disabled}
              onChange={(event) => queue.select(event, existingCount)}
            />
          </label>
        )}
      {queue.selectionError && (
        <p role="alert" className="form-message error">
          {queue.selectionError}
        </p>
      )}
      {queue.files.length > 0 && (
        <ul aria-label="Selected files">
          {queue.files.map(({ file, key, error }) => (
            <li key={key}>
              {file.name}
              <button
                type="button"
                className="text-button"
                aria-label={`Remove selected ${file.name}`}
                disabled={disabled}
                onClick={() => queue.remove(key)}
              >
                Remove
              </button>
              {error && (
                <p role="alert" className="form-message error">
                  {file.name}: {error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttachmentManager({
  kind,
  parentId,
  attachments,
  canEdit,
  csrfToken,
  onChanged,
  onMutationStart,
  onMutationFinish,
}: {
  kind: AttachmentParent;
  parentId: string;
  attachments: Attachment[];
  canEdit: boolean;
  csrfToken: string;
  onChanged: () => void | Promise<void>;
  onMutationStart?: () => void;
  onMutationFinish?: (changed: boolean) => void;
}) {
  const queue = useAttachmentQueue();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function saveFiles() {
    if (pending) return;
    setPending(true);
    onMutationStart?.();
    let changed = false;
    try {
      await queue.upload(kind, parentId, csrfToken, async () => {
        changed = true;
        await onChanged();
      });
    } finally {
      onMutationFinish?.(changed);
      setPending(false);
    }
  }
  async function removeFile(id: string) {
    if (pending) return;
    setPending(true);
    setError("");
    onMutationStart?.();
    let changed = false;
    try {
      await deleteAttachment(id, csrfToken);
      changed = true;
      await onChanged();
    } catch (caught) {
      setError(message(caught));
    } finally {
      onMutationFinish?.(changed);
      setPending(false);
    }
  }
  if (!attachments.length && !canEdit) return null;
  const images = attachments.filter((item) =>
    item.mediaType.startsWith("image/"),
  );
  const documents = attachments.filter(
    (item) => !item.mediaType.startsWith("image/"),
  );
  const remove = (item: Attachment) =>
    canEdit && (
      <button
        type="button"
        className="text-button danger"
        aria-label={`Remove ${item.fileName}`}
        disabled={pending}
        onClick={() => void removeFile(item.id)}
      >
        Remove
      </button>
    );
  return (
    <section
      className="content-attachments"
      role="region"
      aria-label="Attachments"
    >
      {images.map((item) => (
        <figure className="attachment-image" key={item.id}>
          <img src={item.downloadUrl} alt={item.fileName} loading="lazy" />
          <figcaption>
            {item.fileName} {remove(item)}
          </figcaption>
        </figure>
      ))}
      {documents.length > 0 && (
        <ul className="attachment-documents">
          {documents.map((item) => (
            <li key={item.id}>
              <a href={item.downloadUrl}>{item.fileName}</a> {remove(item)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <AttachmentSelection
          queue={queue}
          disabled={pending}
          existingCount={attachments.length}
          allowMore={attachments.length + queue.files.length < MAX_ATTACHMENTS}
        />
      )}
      {canEdit && queue.files.length > 0 && (
        <button
          type="button"
          className="button secondary compact"
          disabled={pending}
          onClick={() => void saveFiles()}
        >
          {pending ? "Uploading…" : "Upload selected files"}
        </button>
      )}
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
    </section>
  );
}
