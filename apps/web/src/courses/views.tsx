import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../auth/client.js";
import {
  createCourse,
  deleteCourse,
  getCourse,
  getMembership,
  joinCourse,
  leaveCourse,
  listCourses,
  listMembers,
  listOrganizations,
  removeMembership,
  updateCourse,
  updateMembership,
  type Course,
  type Membership,
  type Versioned,
} from "./client.js";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

const ROLE_LABELS: Record<Membership["role"], string> = {
  student: "Student",
  ta: "TA",
  instructor: "Instructor",
};
const STATUS_LABELS: Record<Course["status"], string> = {
  active: "Active",
  archived: "Archived (read-only)",
  deleting: "Being deleted",
};

function CourseGlyph({ name }: { name: string }) {
  return (
    <span className="course-icon amber">{name.slice(0, 2).toUpperCase()}</span>
  );
}

function CreateCourseForm({
  csrfToken,
  onCreated,
}: {
  csrfToken: string;
  onCreated: (course: Course) => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const organizations = await listOrganizations();
      const organization = organizations[0];
      if (!organization)
        throw new Error("Your school organization is unavailable.");
      onCreated((await createCourse(organization.id, name, csrfToken)).data);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="course-form" onSubmit={submit}>
      <h3>Create a course</h3>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <label>
        Course name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create course"}
      </button>
    </form>
  );
}

function JoinCourseForm({
  csrfToken,
  onJoined,
}: {
  csrfToken: string;
  onJoined: (courseId: string) => void;
}) {
  const [courseId, setCourseId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await joinCourse(courseId, joinCode.toUpperCase(), csrfToken);
      onJoined(courseId);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="course-form" onSubmit={submit}>
      <h3>Join a course</h3>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <label>
        Course link ID
        <input
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          required
        />
      </label>
      <label>
        Join code
        <input
          maxLength={8}
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
          required
        />
      </label>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Joining…" : "Join course"}
      </button>
    </form>
  );
}

export function CourseHome({
  csrfToken,
  onOpenCourse,
}: {
  csrfToken: string;
  onOpenCourse: (courseId: string) => void;
}) {
  const [courses, setCourses] = useState<Course[]>();
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const [pagePending, setPagePending] = useState(false);
  const [form, setForm] = useState<"create" | "join">();
  const refresh = () => {
    setError(undefined);
    setPageError(undefined);
    void listCourses()
      .then((page) => {
        setCourses(page.data);
        setNextCursor(page.page.nextCursor);
      })
      .catch((caught) => setError(message(caught)));
  };
  const loadMore = () => {
    if (!nextCursor || pagePending) return;
    setPagePending(true);
    setPageError(undefined);
    void listCourses(nextCursor)
      .then((page) => {
        setCourses((current) => [...(current ?? []), ...page.data]);
        setNextCursor(page.page.nextCursor);
      })
      .catch((caught) => setPageError(message(caught)))
      .finally(() => setPagePending(false));
  };
  useEffect(refresh, []);
  if (!courses && error)
    return (
      <section className="courses-card" aria-live="polite">
        <p className="form-message error" role="alert">
          {error}
        </p>
        <button className="text-button" onClick={refresh}>
          Try again
        </button>
      </section>
    );
  if (!courses)
    return (
      <section className="courses-card" aria-live="polite">
        Loading your courses…
      </section>
    );
  return (
    <section className="courses-card" aria-labelledby="courses-heading">
      <div className="section-title">
        <h2 id="courses-heading">Your courses</h2>
        <span>
          {courses.length} {nextCursor ? "shown" : "courses"}
        </span>
      </div>
      {error ? (
        <div className="empty-state">
          <p className="form-message error" role="alert">
            {error}
          </p>
          <button className="text-button" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : courses.length ? (
        courses.map((course) => (
          <button
            className="course-row course-link"
            key={course.id}
            onClick={() => onOpenCourse(course.id)}
          >
            <CourseGlyph name={course.name} />
            <span>
              <strong>{course.name}</strong>
              <small>
                {course.status === "active" ? "Active course" : course.status}
              </small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ))
      ) : (
        <div className="empty-state">
          <p>You have not joined a course yet.</p>
          <p>Create one for your class or use a course link to join.</p>
        </div>
      )}
      <div className="course-actions">
        <button className="button secondary" onClick={() => setForm("create")}>
          Create course
        </button>
        <button className="button secondary" onClick={() => setForm("join")}>
          Join a course
        </button>
      </div>
      {form === "create" && (
        <CreateCourseForm
          csrfToken={csrfToken}
          onCreated={(course) => onOpenCourse(course.id)}
        />
      )}
      {form === "join" && (
        <JoinCourseForm csrfToken={csrfToken} onJoined={onOpenCourse} />
      )}
      {nextCursor && (
        <>
          {pageError && (
            <p className="form-message error" role="alert">
              {pageError}
            </p>
          )}
          <button
            className="text-button"
            disabled={pagePending}
            onClick={loadMore}
          >
            {pagePending
              ? "Loading more courses…"
              : pageError
                ? "Retry loading courses"
                : "Load more courses"}
          </button>
        </>
      )}
    </section>
  );
}

export function CourseDetail({
  courseId,
  course: sharedCourse,
  onCourseChange,
  userId,
  csrfToken,
  onBack,
  onDiscussion,
}: {
  courseId: string;
  course?: Versioned<Course>;
  onCourseChange?: (course: Versioned<Course>) => void;
  userId: string;
  csrfToken: string;
  onBack: () => void;
  onDiscussion?: () => void;
}) {
  const [localCourse, setLocalCourse] = useState<Versioned<Course>>();
  const course = sharedCourse ?? localCourse;
  const setCourse = onCourseChange ?? setLocalCourse;
  const [ownMembership, setOwnMembership] = useState<Membership>();
  const [members, setMembers] = useState<Membership[]>();
  const [membersCursor, setMembersCursor] = useState<string | null>();
  const [membersPageError, setMembersPageError] = useState<string>();
  const [membersPagePending, setMembersPagePending] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<() => void>();
  const [pollCycle, setPollCycle] = useState(0);
  const [name, setName] = useState("");
  const alive = useRef(true);
  const currentCourseId = useRef(courseId);
  currentCourseId.current = courseId;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (course) setName(course.data.name);
  }, [course]);
  const refresh = (preserveNotice = false, refreshCourse = false) => {
    if (!preserveNotice) {
      setError(undefined);
      setRetry(undefined);
    }
    void Promise.all([
      sharedCourse && !refreshCourse
        ? Promise.resolve(sharedCourse)
        : getCourse(courseId),
      getMembership(courseId, userId),
      listMembers(courseId),
    ])
      .then(([nextCourse, nextOwnMembership, nextMembers]) => {
        if (!alive.current || currentCourseId.current !== courseId) return;
        setCourse(nextCourse);
        setName(nextCourse.data.name);
        setOwnMembership(nextOwnMembership.data);
        setMembers(nextMembers.data);
        setMembersCursor(nextMembers.page.nextCursor);
        setMembersPageError(undefined);
      })
      .catch((caught) => {
        if (!alive.current || currentCourseId.current !== courseId) return;
        if (caught instanceof ApiError && caught.code === "not_found") onBack();
        else setError(message(caught));
      });
  };
  // Refresh is intentionally keyed by route identity, not render-time callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [courseId]);
  useEffect(() => {
    if (course?.data.status !== "deleting") return;
    const timer = window.setTimeout(() => {
      refresh(false, true);
      setPollCycle((current) => current + 1);
    }, 1_000);
    return () => window.clearTimeout(timer);
    // Polling is keyed by deletion state and its durable timer cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.data.status, pollCycle]);
  const resolveMutationError = (caught: unknown, repeat: () => void) => {
    if (caught instanceof ApiError && caught.code === "version_conflict") {
      setError(
        "This course changed elsewhere. Details were refreshed; you can retry.",
      );
      setRetry(() => repeat);
      refresh(true, true);
    } else setError(message(caught));
  };
  const instructor = ownMembership?.role === "instructor";
  const canManage = (member: Membership) =>
    instructor &&
    member.user.id !== userId &&
    course?.data.status !== "deleting";
  const [copyState, setCopyState] = useState<string>();
  async function copyJoinCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("Copied");
    } catch {
      setCopyState("Copy failed. Select the code to copy it.");
    }
  }
  const loadMoreMembers = () => {
    if (!membersCursor || membersPagePending) return;
    setMembersPagePending(true);
    setMembersPageError(undefined);
    void listMembers(courseId, membersCursor)
      .then((page) => {
        setMembers((current) => [...(current ?? []), ...page.data]);
        setMembersCursor(page.page.nextCursor);
      })
      .catch((caught) => setMembersPageError(message(caught)))
      .finally(() => setMembersPagePending(false));
  };
  async function changeStatus(status: "active" | "archived") {
    if (!course || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await updateCourse(
        courseId,
        { status },
        csrfToken,
        course.etag,
      );
      if (alive.current && currentCourseId.current === courseId)
        setCourse(next);
    } catch (caught) {
      resolveMutationError(caught, () => void changeStatus(status));
    } finally {
      setPending(false);
    }
  }
  async function rename() {
    if (!course || pending || name.trim() === course.data.name) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await updateCourse(
        courseId,
        { name: name.trim() },
        csrfToken,
        course.etag,
      );
      if (alive.current && currentCourseId.current === courseId)
        setCourse(next);
    } catch (caught) {
      resolveMutationError(caught, () => void rename());
    } finally {
      setPending(false);
    }
  }
  async function startDeletion() {
    if (!course || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await deleteCourse(courseId, csrfToken, course.etag);
      if (alive.current && currentCourseId.current === courseId)
        setCourse(next);
    } catch (caught) {
      resolveMutationError(caught, () => void startDeletion());
    } finally {
      setPending(false);
    }
  }
  async function changeRole(member: Membership, role: Membership["role"]) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const current = await getMembership(courseId, member.user.id);
      await updateMembership(
        courseId,
        member.user.id,
        role,
        csrfToken,
        current.etag,
      );
      refresh();
    } catch (caught) {
      resolveMutationError(caught, () => void changeRole(member, role));
    } finally {
      setPending(false);
    }
  }
  async function remove(member: Membership) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const current = await getMembership(courseId, member.user.id);
      await removeMembership(courseId, member.user.id, csrfToken, current.etag);
      refresh();
    } catch (caught) {
      resolveMutationError(caught, () => void remove(member));
    } finally {
      setPending(false);
    }
  }
  async function leave() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await leaveCourse(courseId, csrfToken);
      onBack();
    } catch (caught) {
      setError(message(caught));
      setPending(false);
    }
  }
  if (!course || !members || !ownMembership)
    return (
      <section className="course-detail loading" aria-live="polite">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Loading course settings…</p>
        )}
        {error && (
          <button className="text-button" onClick={() => refresh()}>
            Try again
          </button>
        )}
      </section>
    );
  return (
    <section className="course-detail">
      {!sharedCourse && (
        <>
          <button className="text-button" onClick={onBack}>
            ← All courses
          </button>
          {onDiscussion && (
            <button className="text-button" onClick={onDiscussion}>
              Discussion
            </button>
          )}
          <header className="course-detail-header">
            <CourseGlyph name={course.data.name} />
            <div>
              <p className="eyebrow">{course.data.status}</p>
              <h1>{course.data.name}</h1>
            </div>
          </header>
        </>
      )}
      {course.data.status === "deleting" && (
        <p className="form-message success" role="status">
          This course is being deleted. We’ll keep checking its progress.
        </p>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {retry && (
        <button className="text-button" onClick={retry}>
          Retry
        </button>
      )}
      <section
        className="settings-card"
        aria-labelledby="course-details-heading"
      >
        <div className="section-title">
          <h2 id="course-details-heading">Course details</h2>
        </div>
        {instructor && course.data.status !== "deleting" ? (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <label htmlFor="course-name-input">Course name</label>
            <div className="field-row">
              <input
                id="course-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                className="button secondary compact"
                disabled={pending}
              >
                Save name
              </button>
            </div>
          </form>
        ) : null}
        <dl className="settings-facts">
          {!(instructor && course.data.status !== "deleting") && (
            <div>
              <dt>Course name</dt>
              <dd>{course.data.name}</dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>{STATUS_LABELS[course.data.status]}</dd>
          </div>
          {course.data.joinCode && (
            <div>
              <dt>Join code</dt>
              <dd className="join-code">
                <code>{course.data.joinCode}</code>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void copyJoinCode(course.data.joinCode!)}
                >
                  Copy join code
                </button>
                {copyState && (
                  <span className="copy-status" role="status">
                    {copyState}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </section>
      <section className="members-card" aria-labelledby="members-heading">
        <div className="section-title">
          <h2 id="members-heading">Members</h2>
          <span>
            {members.length} {membersCursor ? "shown" : "total"}
          </span>
        </div>
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <div>
              <strong>{member.user.displayName}</strong>
              {!canManage(member) && <small>{ROLE_LABELS[member.role]}</small>}
            </div>
            {canManage(member) ? (
              <div className="member-actions">
                <select
                  aria-label={`Role for ${member.user.displayName}`}
                  disabled={pending}
                  onChange={(event) =>
                    void changeRole(
                      member,
                      event.target.value as Membership["role"],
                    )
                  }
                  value={member.role}
                >
                  <option value="student">Student</option>
                  <option value="ta">TA</option>
                  <option value="instructor">Instructor</option>
                </select>
                <button
                  className="text-button danger"
                  disabled={pending}
                  onClick={() => void remove(member)}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {membersCursor && (
          <>
            {membersPageError && (
              <p className="form-message error" role="alert">
                {membersPageError}
              </p>
            )}
            <button
              className="text-button"
              disabled={membersPagePending}
              onClick={loadMoreMembers}
            >
              {membersPagePending
                ? "Loading more members…"
                : membersPageError
                  ? "Retry loading members"
                  : "Load more members"}
            </button>
          </>
        )}
      </section>
      {course.data.status !== "deleting" && (
        <section
          className="settings-card danger-zone"
          aria-labelledby="danger-zone-heading"
        >
          <div className="section-title">
            <h2 id="danger-zone-heading">Danger zone</h2>
          </div>
          {instructor ? (
            <>
              <div className="danger-row">
                <div>
                  <strong>
                    {course.data.status === "active"
                      ? "Archive this course"
                      : "Reopen this course"}
                  </strong>
                  <p>
                    {course.data.status === "active"
                      ? "Everyone keeps read access, but no one can post or join."
                      : "Members can post again and new members can join."}
                  </p>
                </div>
                <button
                  className="button secondary compact"
                  disabled={pending}
                  onClick={() =>
                    void changeStatus(
                      course.data.status === "active" ? "archived" : "active",
                    )
                  }
                >
                  {course.data.status === "active"
                    ? "Archive course"
                    : "Reopen course"}
                </button>
              </div>
              <div className="danger-row">
                <div>
                  <strong>Delete this course</strong>
                  <p>Permanently removes the course and all of its posts.</p>
                </div>
                <button
                  className="button danger compact"
                  disabled={pending}
                  onClick={() => void startDeletion()}
                >
                  Delete course
                </button>
              </div>
            </>
          ) : (
            <div className="danger-row">
              <div>
                <strong>Leave this course</strong>
                <p>You will need a join code to come back.</p>
              </div>
              <button
                className="button danger compact"
                disabled={pending}
                onClick={() => void leave()}
              >
                Leave course
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
