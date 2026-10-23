import { ApiError } from "../auth/client.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  sections as readSections,
  list,
  mutate,
  upload,
  filePath,
  type Resource,
  type Section,
} from "./client.js";
import "./styles.css";
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Resources are unavailable. Please try again.";
type Props = { courseId: string; canUpload: boolean; csrfToken: string };
function fileRetryKey(
  keys: WeakMap<File, Map<string, string>>,
  file: File,
  request: string,
) {
  let requests = keys.get(file);
  if (!requests) {
    requests = new Map();
    keys.set(file, requests);
  }
  let key = requests.get(request);
  if (!key) {
    key = crypto.randomUUID();
    requests.set(request, key);
  }
  return key;
}
export function CourseResources({ courseId, canUpload, csrfToken }: Props) {
  const [items, setItems] = useState<Resource[]>([]),
    [sections, setSections] = useState<Section[]>([]),
    [version, setVersion] = useState(1),
    [cursor, setCursor] = useState<string | null>(null),
    [sort, setSort] = useState("manual"),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>(),
    [cycle, setCycle] = useState(0);
  const [sectionTitle, setSectionTitle] = useState(""),
    [sectionAccess, setSectionAccess] = useState("class"),
    [file, setFile] = useState<File>(),
    [fileTitle, setFileTitle] = useState(""),
    [fileSection, setFileSection] = useState(""),
    [fileAccess, setFileAccess] = useState("class"),
    [linkTitle, setLinkTitle] = useState(""),
    [linkUrl, setLinkUrl] = useState(""),
    [linkSection, setLinkSection] = useState(""),
    [linkAccess, setLinkAccess] = useState("class"),
    [notice, setNotice] = useState<string>();
  const [moreError, setMoreError] = useState(false);
  const [working, setWorking] = useState<"file" | "link">();
  const keys = useRef(new Map<string, string>()),
    fileKeys = useRef(new WeakMap<File, Map<string, string>>()),
    fileInput = useRef<HTMLInputElement>(null);
  const key = (value: unknown) => {
    const hash = JSON.stringify(value);
    if (!keys.current.has(hash)) keys.current.set(hash, crypto.randomUUID());
    return keys.current.get(hash)!;
  };
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    void Promise.all([
      readSections(courseId, c.signal),
      list(courseId, sort, undefined, c.signal),
    ])
      .then(([groups, page]) => {
        if (c.signal.aborted) return;
        setSections(groups.data);
        setItems(page.data);
        setVersion(page.version ?? 1);
        setCursor(page.page.nextCursor);
        setError(undefined);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [courseId, sort, cycle]);
  const refresh = () => setCycle((c) => c + 1);
  async function action(work: () => Promise<unknown>, success?: () => void) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
      success?.();
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function more() {
    if (!cursor || pending) return;
    setPending(true);
    try {
      const page = await list(courseId, sort, cursor);
      setItems((rows) => [
        ...rows,
        ...page.data.filter((i) => !rows.some((r) => r.id === i.id)),
      ]);
      setCursor(page.page.nextCursor);
      setVersion(page.version ?? 1);
      setError(undefined);
      setMoreError(false);
    } catch (e) {
      setError(message(e));
      setMoreError(!(e instanceof ApiError && e.status === 400));
    } finally {
      setPending(false);
    }
  }
  const move = (ids: string[], index: number, direction: number) => {
    const copy = [...ids];
    [copy[index], copy[index + direction]] = [
      copy[index + direction],
      copy[index],
    ];
    return copy;
  };
  async function addSection(event: FormEvent) {
    event.preventDefault();
    await action(
      () =>
        mutate(
          courseId,
          "resource-sections",
          "POST",
          { title: sectionTitle, visibility: sectionAccess },
          csrfToken,
        ),
      () => setSectionTitle(""),
    );
  }
  async function addFile(event: FormEvent) {
    event.preventDefault();
    if (!file || pending) return;
    if (file.size > 100 * 1024 * 1024) {
      setError("Files must be 100 MiB or smaller.");
      return;
    }
    const meta = {
      title: fileTitle || file.name,
      sectionId: fileSection || null,
      visibility: fileAccess,
    };
    const request = JSON.stringify({ courseId, meta });
    setWorking("file");
    await action(
      () =>
        upload(
          courseId,
          file,
          meta,
          csrfToken,
          fileRetryKey(fileKeys.current, file, request),
        ),
      () => {
        fileKeys.current.get(file)?.delete(request);
        setFile(undefined);
        setFileTitle("");
        if (fileInput.current) fileInput.current.value = "";
        setNotice(`${file.name} uploaded.`);
      },
    );
    setWorking(undefined);
  }
  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if ([...linkTitle.trim()].length > 200) {
      setError("Link titles must be 200 characters or fewer.");
      return;
    }
    if ([...linkUrl].length > 2048) {
      setError("Link URLs must be 2048 characters or fewer.");
      return;
    }
    const body = {
      kind: "link",
      title: linkTitle,
      url: linkUrl,
      sectionId: linkSection || null,
      visibility: linkAccess,
    };
    setWorking("link");
    await action(
      () =>
        mutate(
          courseId,
          "resources",
          "POST",
          body,
          csrfToken,
          undefined,
          key(body),
        ),
      () => {
        keys.current.delete(JSON.stringify(body));
        setLinkTitle("");
        setLinkUrl("");
        setNotice("Link added.");
      },
    );
    setWorking(undefined);
  }
  const scope = (id: string | null) =>
    items.filter((r) => (r.sectionId ?? null) === id);
  function group(section: Section | null) {
    const rows = scope(section?.id ?? null);
    return (
      <section
        className="resource-section"
        key={section?.id ?? "ungrouped"}
        aria-label={section?.title ?? "Ungrouped"}
      >
        <div className="resource-section-heading">
          <h3>{section?.title ?? "Ungrouped"}</h3>
          {section?.visibility === "staff" && (
            <span className="resource-visibility">Staff only</span>
          )}
          {section && canUpload && (
            <SectionControls
              key={section.version}
              courseId={courseId}
              section={section}
              csrfToken={csrfToken}
              refresh={refresh}
            />
          )}
        </div>
        {section && canUpload && (
          <div className="resource-order-controls">
            <button
              disabled={pending || sections[0].id === section.id}
              onClick={() =>
                void action(() =>
                  mutate(
                    courseId,
                    "resource-sections/order",
                    "PUT",
                    {
                      ids: move(
                        sections.map((s) => s.id),
                        sections.findIndex((s) => s.id === section.id),
                        -1,
                      ),
                    },
                    csrfToken,
                    version,
                  ),
                )
              }
            >
              Move section up
            </button>
            <button
              disabled={pending || sections.at(-1)?.id === section.id}
              onClick={() =>
                void action(() =>
                  mutate(
                    courseId,
                    "resource-sections/order",
                    "PUT",
                    {
                      ids: move(
                        sections.map((s) => s.id),
                        sections.findIndex((s) => s.id === section.id),
                        1,
                      ),
                    },
                    csrfToken,
                    version,
                  ),
                )
              }
            >
              Move section down
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="course-file-meta">
            {cursor
              ? "More resources may be on later pages."
              : "No resources in this section."}
          </p>
        ) : (
          <ul className="course-files-list">
            {rows.map((item, index) => (
              <li key={`${item.id}:${item.version ?? 1}`}>
                <ResourceRow
                  item={item}
                  courseId={courseId}
                  canUpload={canUpload}
                  csrfToken={csrfToken}
                  sections={sections}
                  refresh={refresh}
                />
                {canUpload && sort === "manual" && (
                  <div className="resource-order-controls">
                    <button
                      disabled={!!cursor || pending || index === 0}
                      onClick={() =>
                        void action(() =>
                          mutate(
                            courseId,
                            "resources/order",
                            "PUT",
                            {
                              ids: move(
                                rows.map((r) => r.id),
                                index,
                                -1,
                              ),
                              sectionId: section?.id ?? null,
                            },
                            csrfToken,
                            version,
                          ),
                        )
                      }
                    >
                      Move resource up
                    </button>
                    <button
                      disabled={
                        !!cursor || pending || index === rows.length - 1
                      }
                      onClick={() =>
                        void action(() =>
                          mutate(
                            courseId,
                            "resources/order",
                            "PUT",
                            {
                              ids: move(
                                rows.map((r) => r.id),
                                index,
                                1,
                              ),
                              sectionId: section?.id ?? null,
                            },
                            csrfToken,
                            version,
                          ),
                        )
                      }
                    >
                      Move resource down
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section
      className="course-files organized-resources"
      aria-label="Course resources"
    >
      <div className="course-files-heading">
        <h2>Course resources</h2>
        <p>Files and links shared with your course.</p>
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="button secondary"
            onClick={moreError ? () => void more() : refresh}
          >
            Try again
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {working === "file" && <p role="status">Uploading your file…</p>}
      {loading && <p role="status">Loading course resources…</p>}
      {canUpload && (
        <div className="resource-management">
          <form onSubmit={addSection} className="course-links-form">
            <h3>Create a section</h3>
            <label>
              Section title
              <input
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={sectionAccess === "staff"}
                onChange={(e) =>
                  setSectionAccess(e.target.checked ? "staff" : "class")
                }
              />
              Staff only section
            </label>
            <button
              className="button primary"
              disabled={pending || loading || !sectionTitle.trim()}
            >
              Add section
            </button>
          </form>
          <form onSubmit={addFile} className="course-files-upload">
            <h3>Add a file</h3>
            <label>
              File
              <input
                aria-label="Choose a course file"
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.pptx"
                onChange={(e) => setFile(e.target.files?.[0])}
                disabled={pending}
              />
            </label>
            <label>
              File title
              <input
                value={fileTitle}
                onChange={(e) => setFileTitle(e.target.value)}
                disabled={pending}
                placeholder="Use filename"
              />
            </label>
            <SectionSelect
              label="File section"
              value={fileSection}
              set={setFileSection}
              sections={sections}
            />
            <label>
              <input
                type="checkbox"
                checked={fileAccess === "staff"}
                onChange={(e) =>
                  setFileAccess(e.target.checked ? "staff" : "class")
                }
              />
              Staff only file
            </label>
            <p id="course-file-formats">
              PDF, text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. Up to 100 MiB.
            </p>
            <button
              className="button primary"
              disabled={!file || pending || loading}
            >
              {working === "file" ? "Uploading…" : "Upload file"}
            </button>
          </form>
          <form className="course-links-form" onSubmit={addLink}>
            <h3>Add a link</h3>
            <label>
              Link title
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            <label>
              Link URL
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            <SectionSelect
              label="Link section"
              value={linkSection}
              set={setLinkSection}
              sections={sections}
            />
            <label>
              <input
                type="checkbox"
                checked={linkAccess === "staff"}
                onChange={(e) =>
                  setLinkAccess(e.target.checked ? "staff" : "class")
                }
              />
              Staff only link
            </label>
            <button
              className="button primary"
              disabled={pending || loading || !linkTitle.trim() || !linkUrl}
            >
              {working === "link" ? "Adding link…" : "Add link"}
            </button>
          </form>
        </div>
      )}
      {!loading && (
        <>
          <label className="resource-sort">
            Sort resources
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="manual">Instructor order</option>
              <option value="title">Title</option>
              <option value="date">Newest first</option>
            </select>
          </label>
          {items.length === 0 && sections.length === 0 && !cursor && (
            <p className="course-files-empty">No course resources yet.</p>
          )}
          {scope(null).length > 0 && group(null)}
          {sections.map(group)}
          {cursor && (
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => void more()}
            >
              Load more
            </button>
          )}
          {cursor && canUpload && (
            <p className="course-file-meta">
              Load all resources to change their order.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function SectionSelect({
  label,
  value,
  set,
  sections,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  sections: Section[];
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">Ungrouped</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
            {s.visibility === "staff" ? " (staff only)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
function SectionControls({
  courseId,
  section,
  csrfToken,
  refresh,
}: {
  courseId: string;
  section: Section;
  csrfToken: string;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(section.title),
    [access, setAccess] = useState(section.visibility),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await mutate(
        courseId,
        `resource-sections/${section.id}`,
        "PATCH",
        { title, visibility: access },
        csrfToken,
        section.version,
      );
      setEditing(false);
      setError(undefined);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    try {
      await mutate(
        courseId,
        `resource-sections/${section.id}`,
        "DELETE",
        {},
        csrfToken,
        section.version,
      );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="resource-section-controls">
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <form onSubmit={save} aria-label="Edit section">
          <label>
            Section name
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={access === "staff"}
              onChange={(e) => setAccess(e.target.checked ? "staff" : "class")}
            />
            Staff only section
          </label>
          <button disabled={pending}>Save section</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)}>
          Edit section {section.title}
        </button>
      )}
      {confirm ? (
        <div>
          <p>
            Remove this section? Its resources will stay ungrouped with their
            access restrictions.
          </p>
          <button disabled={pending} onClick={() => void remove()}>
            Confirm remove section
          </button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)}>
          Remove section {section.title}
        </button>
      )}
    </div>
  );
}
function ResourceRow({
  item,
  courseId,
  canUpload,
  csrfToken,
  sections,
  refresh,
}: Props & { item: Resource; sections: Section[]; refresh: () => void }) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(item.title ?? item.fileName ?? ""),
    [section, setSection] = useState(item.sectionId ?? ""),
    [access, setAccess] = useState(item.visibility ?? "class"),
    [url, setUrl] = useState(item.kind === "link" ? (item.url ?? "") : ""),
    [file, setFile] = useState<File>(),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(false),
    [confirm, setConfirm] = useState(false);
  const keys = useRef(new WeakMap<File, Map<string, string>>());
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const metadata = {
        title,
        sectionId: section || null,
        visibility: access,
      };
      if (file) {
        const request = JSON.stringify({
          courseId,
          id: item.id,
          version: item.version,
          metadata,
        });
        await upload(
          courseId,
          file,
          metadata,
          csrfToken,
          fileRetryKey(keys.current, file, request),
          item,
        );
        keys.current.get(file)?.delete(request);
      } else
        await mutate(
          courseId,
          `resources/${item.id}`,
          "PATCH",
          { ...metadata, ...(url ? { url } : {}) },
          csrfToken,
          item.version,
        );
      setEditing(false);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    try {
      await mutate(
        courseId,
        `resources/${item.id}`,
        "DELETE",
        {},
        csrfToken,
        item.version,
      );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  const name = item.title ?? item.fileName ?? "";
  return (
    <>
      <a
        href={item.kind === "upload" ? filePath(courseId, item) : item.url}
        {...(item.kind === "link"
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {name}
      </a>
      <div className="course-file-meta">
        <span>{item.kind === "upload" ? item.fileName : "External link"}</span>
        {item.kind === "upload" && (
          <span>
            {(item.sizeBytes ?? 0) < 1024
              ? `${item.sizeBytes ?? 0} B`
              : (item.sizeBytes ?? 0) < 1048576
                ? `${Number(((item.sizeBytes ?? 0) / 1024).toFixed(1))} KB`
                : `${Number(((item.sizeBytes ?? 0) / 1048576).toFixed(1))} MB`}
          </span>
        )}
        {item.visibility === "staff" && <span>Staff only</span>}
      </div>
      {error && !editing && <p role="alert">{error}</p>}
      {canUpload &&
        (editing ? (
          <form
            aria-label="Edit resource"
            className="resource-edit-form"
            onSubmit={save}
          >
            {error && <p role="alert">{error}</p>}
            <label>
              Resource title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <SectionSelect
              label="Resource section"
              value={section}
              set={setSection}
              sections={sections}
            />
            <label>
              <input
                type="checkbox"
                checked={access === "staff"}
                onChange={(e) =>
                  setAccess(e.target.checked ? "staff" : "class")
                }
              />
              Staff only resource
            </label>
            <label>
              {item.kind === "link" ? "Resource URL" : "Replace with link URL"}
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Replacement file
              <input
                type="file"
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.pptx"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                }}
              />
            </label>
            <div className="resource-edit-actions">
              <button disabled={pending}>Save resource</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              {error && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    refresh();
                  }}
                >
                  Reload latest resource
                </button>
              )}
            </div>
          </form>
        ) : (
          <button onClick={() => setEditing(true)}>Edit {name}</button>
        ))}
      {canUpload &&
        (confirm ? (
          <div>
            <p>Remove {name}?</p>
            <button disabled={pending} onClick={() => void remove()}>
              Confirm remove resource
            </button>
            <button onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)}>Remove {name}</button>
        ))}
    </>
  );
}
