import { useEffect, useRef, useState, type FormEvent } from "react";
import { CourseResources } from "../course-files/views.js";
import { downloadPath } from "../course-files/client.js";
import { MarkdownEditorField } from "../posts/MarkdownEditorField.js";
import { PostBody } from "../posts/PostBody.js";
import { ApiError } from "../auth/client.js";
import {
  readInformation,
  readStaff,
  saveInformation,
  saveStaff,
  replaceSyllabus,
  removeSyllabus,
  type Information,
  type Staff,
} from "./client.js";
import "./styles.css";
type Props = { courseId: string; canEdit: boolean; csrfToken: string };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to save. Please try again.";
export function CourseResourcesArea(props: Props) {
  const [tab, setTab] = useState<"information" | "staff" | "resources">(
    "resources",
  );
  const [opened, setOpened] = useState({
    information: false,
    staff: false,
  });
  const selectTab = (next: typeof tab) => {
    setTab(next);
    if (next !== "resources")
      setOpened((current) => ({ ...current, [next]: true }));
  };
  return (
    <div className="course-resources-area">
      <div
        className="course-resource-tabs"
        role="tablist"
        aria-label="Course resources sections"
      >
        {(
          [
            ["information", "Course information"],
            ["staff", "Staff"],
            ["resources", "Resources"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            id={`resource-tab-${key}`}
            role="tab"
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={(event) => {
              const keys = ["information", "staff", "resources"] as const;
              const index = keys.indexOf(key);
              const next =
                event.key === "ArrowRight"
                  ? keys[(index + 1) % keys.length]
                  : event.key === "ArrowLeft"
                    ? keys[(index + keys.length - 1) % keys.length]
                    : event.key === "Home"
                      ? keys[0]
                      : event.key === "End"
                        ? keys[2]
                        : undefined;
              if (next) {
                event.preventDefault();
                selectTab(next);
                document.getElementById(`resource-tab-${next}`)?.focus();
              }
            }}
            aria-selected={tab === key}
            aria-controls={`resource-panel-${key}`}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {opened.information && (
        <section
          id="resource-panel-information"
          role="tabpanel"
          aria-labelledby="resource-tab-information"
          hidden={tab !== "information"}
        >
          <InformationPanel {...props} />
        </section>
      )}
      {opened.staff && (
        <section
          id="resource-panel-staff"
          role="tabpanel"
          aria-labelledby="resource-tab-staff"
          hidden={tab !== "staff"}
        >
          <StaffPanel {...props} active={tab === "staff"} />
        </section>
      )}
      {tab === "resources" && (
        <section
          id="resource-panel-resources"
          role="tabpanel"
          aria-labelledby="resource-tab-resources"
        >
          <CourseResources
            courseId={props.courseId}
            canUpload={props.canEdit}
            csrfToken={props.csrfToken}
          />
        </section>
      )}
    </div>
  );
}
function InformationPanel({ courseId, canEdit, csrfToken }: Props) {
  const [data, setData] = useState<Information>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [file, setFile] = useState<File>();
  useEffect(() => {
    const controller = new AbortController();
    void readInformation(courseId, controller.signal)
      .then((value) => {
        setData(value);
        setDescription(value.descriptionMarkdown);
        setWebsite(value.website ?? "");
        setError(undefined);
        setStale(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, cycle]);
  const fail = (e: unknown) => {
    setError(message(e));
    setStale(e instanceof ApiError && e.status === 412);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const value = await saveInformation(
        courseId,
        { descriptionMarkdown: description, website: website || null },
        csrfToken,
        data.version,
      );
      setData(value);
      setFile(undefined);
      setEditing(false);
      setStale(false);
    } catch (e) {
      fail(e);
    } finally {
      setPending(false);
    }
  }
  async function syllabus(remove = false) {
    if (!data || pending || (!remove && !file)) return;
    setPending(true);
    setError(undefined);
    try {
      const value = remove
        ? await removeSyllabus(courseId, csrfToken, data.version)
        : await replaceSyllabus(courseId, file!, csrfToken, data.version);
      setData(value);
      setFile(undefined);
      setStale(false);
    } catch (e) {
      fail(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="course-information">
      <header>
        <h2>Course information</h2>
        {canEdit && data && !editing && (
          <button className="button primary" onClick={() => setEditing(true)}>
            Edit course information
          </button>
        )}
      </header>
      {loading && <p role="status">Loading course information…</p>}
      {error && (
        <p role="alert" className="course-information-error">
          {error}
        </p>
      )}
      {stale && (
        <button
          className="button secondary"
          onClick={() => {
            setEditing(false);
            setFile(undefined);
            setCycle((c) => c + 1);
          }}
        >
          Reload latest information
        </button>
      )}
      {!data && !loading && (
        <button
          className="button secondary"
          onClick={() => {
            setLoading(true);
            setCycle((c) => c + 1);
          }}
        >
          Retry
        </button>
      )}
      {data &&
        (editing ? (
          <form onSubmit={save}>
            <MarkdownEditorField
              label="Course description"
              value={description}
              onChange={setDescription}
              disabled={pending}
              disableImages
            />
            <label>
              Course website
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={pending}
              />
            </label>
            <div className="course-information-actions">
              <button className="button primary" disabled={pending || stale}>
                Save information
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setDescription(data.descriptionMarkdown);
                  setWebsite(data.website ?? "");
                  setError(undefined);
                  setStale(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {data.descriptionMarkdown ? (
              <PostBody bodyMarkdown={data.descriptionMarkdown} disableImages />
            ) : (
              <p className="course-information-empty">
                Course information has not been added.
              </p>
            )}
            {data.website && (
              <p>
                <a
                  href={data.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Course website
                </a>
              </p>
            )}
          </>
        ))}
      {data && (
        <section className="course-information-syllabus">
          <h3>Syllabus</h3>
          {data.syllabus ? (
            <a href={downloadPath(courseId, data.syllabus.id)}>
              {data.syllabus.fileName}
            </a>
          ) : (
            <p className="course-information-empty">
              No syllabus has been added.
            </p>
          )}
          {canEdit && (
            <div>
              <label>
                Syllabus file
                <input
                  key={`${data.version}:${cycle}`}
                  type="file"
                  disabled={pending || stale}
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              </label>
              <small>
                PDF, text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. Up to 100
                MiB.
              </small>
              <div className="course-information-actions">
                <button
                  className="button primary"
                  disabled={!file || pending || stale}
                  onClick={() => void syllabus()}
                >
                  {data.syllabus ? "Replace syllabus" : "Upload syllabus"}
                </button>
                {data.syllabus && (
                  <button
                    className="button secondary"
                    disabled={pending || stale}
                    onClick={() => void syllabus(true)}
                  >
                    Remove syllabus
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
function StaffPanel({
  courseId,
  canEdit,
  csrfToken,
  active,
}: Props & { active: boolean }) {
  const [data, setData] = useState<Staff[]>();
  const [error, setError] = useState<string>();
  const [cycle, setCycle] = useState(0);
  const saveGeneration = useRef(0);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    const startedBeforeSave = saveGeneration.current;
    void readStaff(courseId, c.signal)
      .then((v) => {
        if (c.signal.aborted || startedBeforeSave !== saveGeneration.current)
          return;
        setData(v);
        setError(undefined);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [courseId, cycle, active]);
  return (
    <div className="course-information">
      <h2>Staff</h2>
      {error && (
        <>
          <p role="alert" className="course-information-error">
            {error}
          </p>
          <button
            className="button secondary"
            onClick={() => setCycle((c) => c + 1)}
          >
            Retry
          </button>
        </>
      )}
      {!data && !error && <p role="status">Loading staff…</p>}
      {data?.length === 0 && <p>No staff details are available.</p>}
      <div className="course-staff-grid">
        {data?.map((person) => (
          <StaffCard
            key={person.userId}
            person={person}
            courseId={courseId}
            canEdit={canEdit}
            csrfToken={csrfToken}
            onSaved={(saved) => {
              saveGeneration.current += 1;
              setData((rows) =>
                rows?.map((r) => (r.userId === saved.userId ? saved : r)),
              );
            }}
            onReload={() => setCycle((c) => c + 1)}
          />
        ))}
      </div>
    </div>
  );
}
function StaffCard({
  person,
  courseId,
  canEdit,
  csrfToken,
  onSaved,
  onReload,
}: Props & {
  person: Staff;
  onSaved: (p: Staff) => void;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [contact, setContact] = useState(person.contact),
    [location, setLocation] = useState(person.location),
    [officeHours, setOfficeHours] = useState(person.officeHours),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>(),
    [stale, setStale] = useState(false),
    [draftVersion, setDraftVersion] = useState(person.version);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      onSaved(
        await saveStaff(
          courseId,
          person.userId,
          { contact, location, officeHours },
          csrfToken,
          draftVersion,
        ),
      );
      setEditing(false);
    } catch (e) {
      setError(message(e));
      setStale(e instanceof ApiError && e.status === 412);
    } finally {
      setPending(false);
    }
  }
  return (
    <article className="course-staff-card">
      <h3>{person.displayName}</h3>
      <p className="course-staff-role">
        {person.role === "instructor" ? "Instructor" : "Teaching assistant"}
      </p>
      {error && (
        <p role="alert" className="course-information-error">
          {error}
        </p>
      )}
      {editing ? (
        <form onSubmit={save}>
          {(
            [
              ["Contact", contact, setContact],
              ["Location", location, setLocation],
              ["Office hours", officeHours, setOfficeHours],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label}>
              {label}
              <textarea
                value={value}
                onChange={(e) => set(e.target.value)}
                disabled={pending}
              />
            </label>
          ))}
          <div className="course-information-actions">
            <button className="button primary" disabled={pending || stale}>
              Save staff details
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {stale && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(undefined);
                  setStale(false);
                  onReload();
                }}
              >
                Reload latest staff details
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <dl>
            {person.contact && (
              <>
                <dt>Contact</dt>
                <dd>{person.contact}</dd>
              </>
            )}
            {person.location && (
              <>
                <dt>Location</dt>
                <dd>{person.location}</dd>
              </>
            )}
            {person.officeHours && (
              <>
                <dt>Office hours</dt>
                <dd>{person.officeHours}</dd>
              </>
            )}
          </dl>
          {!person.contact && !person.location && !person.officeHours && (
            <p className="course-information-empty">
              Contact and office hours have not been added.
            </p>
          )}
          {canEdit && (
            <button
              className="button secondary"
              onClick={() => {
                setContact(person.contact);
                setLocation(person.location);
                setOfficeHours(person.officeHours);
                setDraftVersion(person.version);
                setEditing(true);
              }}
            >
              Edit staff details
            </button>
          )}
        </>
      )}
    </article>
  );
}
