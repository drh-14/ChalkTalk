import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  downloadPath,
  listResources,
  uploadFile,
  createLink,
  type CourseResource,
} from "./client.js";
import "./styles.css";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Files are unavailable. Please try again.";
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}
const formats: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX",
};
export function CourseResources({
  courseId,
  canUpload,
  csrfToken,
}: {
  courseId: string;
  canUpload: boolean;
  csrfToken: string;
}) {
  const [files, setFiles] = useState<CourseResource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<{ message: string; more: boolean }>();
  const [cycle, setCycle] = useState(0);
  const [selection, setSelection] = useState<{ file: File; key: string }>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const linkKey = useRef<string | undefined>(undefined);

  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  useEffect(() => {
    const versionRef = version;
    const current = ++version.current;
    const controller = new AbortController();
    setLoading(true);
    setMoreLoading(false);
    setError(undefined);
    void listResources(courseId, undefined, controller.signal)
      .then((page) => {
        if (version.current !== current) return;
        setFiles(page.data);
        setCursor(page.page.nextCursor);
      })
      .catch((caught) => {
        if (version.current === current && !controller.signal.aborted)
          setError({ message: message(caught), more: false });
      })
      .finally(() => {
        if (version.current === current) setLoading(false);
      });
    return () => {
      controller.abort();
      ++versionRef.current;
    };
  }, [courseId, cycle]);
  async function more() {
    if (!cursor || loading || moreLoading) return;
    const current = version.current;
    setMoreLoading(true);
    setError(undefined);
    try {
      const page = await listResources(courseId, cursor);
      if (current !== version.current) return;
      setFiles((rows) => [
        ...rows,
        ...page.data.filter(
          (file) =>
            !rows.some((row) => row.id === file.id && row.kind === file.kind),
        ),
      ]);
      setCursor(page.page.nextCursor);
    } catch (caught) {
      if (current === version.current)
        setError({ message: message(caught), more: true });
    } finally {
      if (current === version.current) setMoreLoading(false);
    }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!selection || uploading || addingLink || loading || !canUpload) return;
    if (selection.file.size > 100 * 1024 * 1024) {
      setUploadError("Choose a file no larger than 100 MB.");
      return;
    }
    const current = version.current;
    setUploading(true);
    setUploadError(undefined);
    setNotice(undefined);
    try {
      await uploadFile(courseId, selection.file, csrfToken, selection.key);
      if (current !== version.current) return;
      setNotice(`${selection.file.name} uploaded.`);
      setSelection(undefined);
      if (input.current) input.current.value = "";
      setCycle((value) => value + 1);
    } catch (caught) {
      if (current === version.current) setUploadError(message(caught));
    } finally {
      if (current === version.current) setUploading(false);
    }
  }
  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (addingLink || uploading || loading || !canUpload) return;
    if ([...linkTitle.trim()].length > 200) {
      setLinkError("Link title must be 200 characters or fewer.");
      return;
    }
    if ([...linkUrl.trim()].length > 2048) {
      setLinkError("Link URL must be 2048 characters or fewer.");
      return;
    }
    const key = linkKey.current ?? crypto.randomUUID();
    linkKey.current = key;
    const current = version.current;
    setAddingLink(true);
    setLinkError(undefined);
    setNotice(undefined);
    try {
      await createLink(courseId, linkTitle, linkUrl, csrfToken, key);
      if (current !== version.current) return;
      setNotice(`${linkTitle.trim()} added.`);
      setLinkTitle("");
      setLinkUrl("");
      linkKey.current = undefined;
      setCycle((v) => v + 1);
    } catch (caught) {
      if (current === version.current) setLinkError(message(caught));
    } finally {
      if (current === version.current) setAddingLink(false);
    }
  }
  return (
    <section className="course-files" aria-labelledby="course-files-title">
      <div className="course-files-heading">
        <h2 id="course-files-title">Course resources</h2>
        <p>Files and links shared by your instructors.</p>
      </div>
      {canUpload && (
        <form
          className="course-files-upload"
          onSubmit={(event) => void upload(event)}
          aria-label="Upload course file"
        >
          <label htmlFor="course-file-upload">Choose a course file</label>
          <p id="course-file-formats">
            PDF, text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. Up to 100 MB.
          </p>
          <div>
            <input
              ref={input}
              id="course-file-upload"
              type="file"
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.pptx"
              aria-describedby="course-file-formats"
              disabled={uploading || addingLink}
              onChange={(event) => {
                const file = event.target.files?.[0];
                setSelection(
                  file ? { file, key: crypto.randomUUID() } : undefined,
                );
                setUploadError(undefined);
                setNotice(undefined);
              }}
            />
            <button
              className="button primary"
              type="submit"
              disabled={!selection || uploading || addingLink || loading}
            >
              {uploading ? "Uploading…" : "Upload file"}
            </button>
          </div>
          {uploading && <p role="status">Uploading your file…</p>}
          {uploadError && (
            <p role="alert">
              {uploadError} Your file selection is saved; you can retry.
            </p>
          )}
        </form>
      )}
      {canUpload && (
        <form
          className="course-files-upload course-links-form"
          aria-label="Add external link"
          onSubmit={(event) => void addLink(event)}
        >
          <label htmlFor="resource-link-title">Link title</label>
          <input
            id="resource-link-title"
            required
            value={linkTitle}
            disabled={addingLink || uploading}
            onChange={(event) => {
              setLinkTitle(event.target.value);
              linkKey.current = undefined;
              setLinkError(undefined);
            }}
          />
          <label htmlFor="resource-link-url">Link URL</label>
          <input
            id="resource-link-url"
            type="url"
            required
            placeholder="https://example.edu/notes"
            value={linkUrl}
            disabled={addingLink || uploading}
            onChange={(event) => {
              setLinkUrl(event.target.value);
              linkKey.current = undefined;
              setLinkError(undefined);
            }}
          />
          <p>Use an HTTP or HTTPS link without a username or password.</p>
          <button
            className="button primary"
            type="submit"
            disabled={
              addingLink ||
              uploading ||
              loading ||
              !linkTitle.trim() ||
              !linkUrl.trim()
            }
          >
            {addingLink ? "Adding link…" : "Add link"}
          </button>
          {addingLink && <p role="status">Adding your link…</p>}
          {linkError && (
            <p role="alert">
              {linkError} Your link is saved in the form; you can retry.
            </p>
          )}
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading course files…</p>}
      {error && (
        <div role="alert">
          {error.message}{" "}
          <button
            className="button secondary compact"
            type="button"
            onClick={() =>
              error.more ? void more() : setCycle((value) => value + 1)
            }
            disabled={loading || moreLoading || uploading || addingLink}
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !error && files.length === 0 && (
        <p className="course-files-empty">No course resources yet.</p>
      )}
      {files.length > 0 && (
        <ul className="course-files-list" aria-label="Course resources">
          {files.map((file) => (
            <li key={`${file.kind}:${file.id}`}>
              {file.kind === "upload" ? (
                <a href={downloadPath(courseId, file.id)}>{file.fileName}</a>
              ) : (
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  {file.title}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              )}
              <div className="course-file-meta">
                {file.kind === "upload" ? (
                  <>
                    <span>{formats[file.mediaType] ?? file.mediaType}</span>
                    <span>{size(file.sizeBytes)}</span>
                  </>
                ) : (
                  <span>External link · Opens in a new tab</span>
                )}
                <time dateTime={file.createdAt}>
                  {new Date(file.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button
          className="button secondary"
          type="button"
          disabled={loading || moreLoading}
          onClick={() => void more()}
        >
          {moreLoading ? "Loading more…" : "Load more"}
        </button>
      )}
    </section>
  );
}
