import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ApiError,
  changePassword,
  deleteAccount,
  getProfile,
  updateDisplayName,
  type Session,
  type User,
  type VersionedProfile,
} from "../auth/client.js";

import {
  getEmailPreferences,
  listCourses,
  updateEmailPreferences,
  type Course,
  type EmailPreferences,
  type Versioned,
} from "../courses/client.js";

const emailChoices = [
  ["activityEmails", "Activity emails on followed posts"],
  ["announcementEmails", "Announcement emails"],
  ["digestEmails", "Daily digest emails"],
] as const;

function CourseEmailSettings({
  course,
  csrfToken,
}: {
  course: Course;
  csrfToken: string;
}) {
  const [preferences, setPreferences] = useState<Versioned<EmailPreferences>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let active = true;
    void getEmailPreferences(course.id)
      .then((value) => {
        if (active) setPreferences(value);
      })
      .catch((caught: unknown) => {
        if (active) setError(message(caught));
      });
    return () => {
      active = false;
    };
  }, [course.id]);
  async function change(key: keyof EmailPreferences, enabled: boolean) {
    if (!preferences || pending) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setPreferences(
        await updateEmailPreferences(
          course.id,
          { [key]: enabled },
          csrfToken,
          preferences.etag,
        ),
      );
      setNotice("Email preference saved");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "version_conflict") {
        try {
          setPreferences(await getEmailPreferences(course.id));
          setError(
            "Your email preferences changed elsewhere. Review the current choices and try again.",
          );
        } catch (refreshError) {
          setError(message(refreshError));
        }
      } else setError(message(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset
      className="account-email-course"
      disabled={pending || !preferences}
    >
      <legend>{course.name}</legend>
      {!preferences && !error && (
        <p role="status">Loading email preferences…</p>
      )}
      {emailChoices.map(([key, label]) => (
        <label className="checkbox-label" key={key}>
          <input
            type="checkbox"
            checked={preferences?.data[key] ?? false}
            onChange={(event) => void change(key, event.target.checked)}
          />
          {label}
        </label>
      ))}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-message success" role="status">
          {notice}
        </p>
      )}
    </fieldset>
  );
}

type Props = {
  session: Session;
  onUserChange: (user: User) => void;
  onDeleted: () => void;
};

function message(error: unknown): string {
  if (error instanceof ApiError && error.code === "last_instructor")
    return "You are the final instructor in a course. Assign another instructor before deleting your account.";
  return error instanceof Error ? error.message : "Please try again.";
}

export function AccountPage({ session, onUserChange, onDeleted }: Props) {
  const [courses, setCourses] = useState<Course[]>();
  const [coursesError, setCoursesError] = useState<string>();
  const [profile, setProfile] = useState<VersionedProfile>();
  const [loadError, setLoadError] = useState<string>();
  const [name, setName] = useState("");
  const [namePending, setNamePending] = useState(false);
  const [nameNotice, setNameNotice] = useState<string>();
  const [nameError, setNameError] = useState<string>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deletePasswordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getProfile()
      .then((value) => {
        if (!active) return;
        setProfile(value);
        setName(value.data.displayName);
        onUserChange(value.data);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(message(error));
      });
    return () => {
      active = false;
    };
  }, [onUserChange]);

  useEffect(() => {
    let active = true;
    async function loadCourses() {
      try {
        const all: Course[] = [];
        let cursor: string | undefined;
        do {
          const result = await listCourses(cursor);
          if (!active) return;
          all.push(...result.data);
          cursor = result.page.nextCursor ?? undefined;
        } while (cursor);
        if (active) setCourses(all);
      } catch (caught) {
        if (active) setCoursesError(message(caught));
      }
    }
    void loadCourses();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (confirmDelete) deletePasswordInput.current?.focus();
  }, [confirmDelete]);

  async function refreshAfterConflict(setError: (value: string) => void) {
    try {
      const latest = await getProfile();
      setProfile(latest);
      setName(latest.data.displayName);
      onUserChange(latest.data);
      setError(
        "Your account changed elsewhere. Review the current information and try again.",
      );
    } catch (error) {
      setError(message(error));
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || namePending) return;
    setNamePending(true);
    setNameError(undefined);
    setNameNotice(undefined);
    try {
      const updated = await updateDisplayName(
        name,
        profile.etag,
        session.csrfToken,
      );
      setProfile(updated);
      setName(updated.data.displayName);
      onUserChange(updated.data);
      setNameNotice("Name updated");
    } catch (error) {
      if (error instanceof ApiError && error.code === "version_conflict")
        await refreshAfterConflict(setNameError);
      else setNameError(message(error));
    } finally {
      setNamePending(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || passwordPending) return;
    setPasswordError(undefined);
    setPasswordNotice(undefined);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    setPasswordPending(true);
    try {
      await changePassword(
        currentPassword,
        newPassword,
        profile.etag,
        session.csrfToken,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "version_conflict")
        await refreshAfterConflict(setPasswordError);
      else setPasswordError(message(error));
      setPasswordPending(false);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordNotice("Password changed");
    try {
      const updated = await getProfile();
      setProfile(updated);
      setName((current) =>
        current === profile.data.displayName
          ? updated.data.displayName
          : current,
      );
      setNameNotice(undefined);
      onUserChange(updated.data);
    } catch (error) {
      setPasswordError(
        `Account information could not be refreshed: ${message(error)}`,
      );
    } finally {
      setPasswordPending(false);
    }
  }

  function closeDeletion() {
    if (deletePending) return;
    setConfirmDelete(false);
    setDeletePassword("");
    setDeleteError(undefined);
    requestAnimationFrame(() => deleteTrigger.current?.focus());
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeDeletion();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "input:not(:disabled), button:not(:disabled)",
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || deletePending) return;
    setDeletePending(true);
    setDeleteError(undefined);
    try {
      await deleteAccount(deletePassword, profile.etag, session.csrfToken);
      onDeleted();
    } catch (error) {
      if (error instanceof ApiError && error.code === "version_conflict")
        await refreshAfterConflict(setDeleteError);
      else setDeleteError(message(error));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <main className="account-page">
      <div className="account-page-intro">
        <p className="eyebrow">Your ChalkTalk account</p>
        <h1>Account settings</h1>
        <p>Manage how your name appears and keep your account secure.</p>
      </div>
      {loadError && (
        <p className="form-message error" role="alert">
          {loadError}
        </p>
      )}
      {!profile && !loadError && <p role="status">Loading account…</p>}
      {profile && (
        <div className="account-page-sections">
          <section
            className="account-section"
            aria-labelledby="account-profile-heading"
          >
            <h2 id="account-profile-heading">Profile</h2>
            <p className="account-email">{profile.data.email}</p>
            <form onSubmit={saveName}>
              <label htmlFor="account-display-name">Display name</label>
              <input
                id="account-display-name"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              {nameError && (
                <p className="form-message error" role="alert">
                  {nameError}
                </p>
              )}
              {nameNotice && (
                <p className="form-message success" role="status">
                  {nameNotice}
                </p>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={
                  namePending ||
                  !name.trim() ||
                  name.trim() === profile.data.displayName
                }
              >
                {namePending ? "Saving…" : "Save name"}
              </button>
            </form>
          </section>

          <section
            className="account-section"
            aria-labelledby="account-email-heading"
          >
            <h2 id="account-email-heading">Course email notifications</h2>
            <p>
              Choose emails for each course. In-app notifications are unchanged.
            </p>
            {!courses && !coursesError && <p role="status">Loading courses…</p>}
            {coursesError && (
              <p className="form-message error" role="alert">
                {coursesError}
              </p>
            )}
            {courses?.length === 0 && (
              <p>You are not enrolled in any courses.</p>
            )}
            {courses?.map((course) => (
              <CourseEmailSettings
                key={course.id}
                course={course}
                csrfToken={session.csrfToken}
              />
            ))}
          </section>

          <section
            className="account-section"
            aria-labelledby="account-password-heading"
          >
            <h2 id="account-password-heading">Password</h2>
            <p>Use 12 to 128 characters for your new password.</p>
            <form onSubmit={savePassword}>
              <label htmlFor="account-current-password">Current password</label>
              <input
                id="account-current-password"
                autoComplete="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              <label htmlFor="account-new-password">New password</label>
              <input
                id="account-new-password"
                autoComplete="new-password"
                type="password"
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <label htmlFor="account-confirm-password">
                Confirm new password
              </label>
              <input
                id="account-confirm-password"
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              {passwordError && (
                <p className="form-message error" role="alert">
                  {passwordError}
                </p>
              )}
              {passwordNotice && (
                <p className="form-message success" role="status">
                  {passwordNotice}
                </p>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={passwordPending}
              >
                {passwordPending ? "Changing…" : "Change password"}
              </button>
            </form>
          </section>
          <section
            className="account-section account-danger"
            aria-labelledby="account-delete-heading"
          >
            <h2 id="account-delete-heading">Delete account</h2>
            <p>
              Deleting your account signs you out. Your past contributions
              remain with your name removed.
            </p>
            <button
              ref={deleteTrigger}
              type="button"
              className="button danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete account
            </button>
          </section>
        </div>
      )}
      {confirmDelete && (
        <div className="account-dialog-backdrop">
          <div
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="delete-account-title">Delete account</h2>
            <p>
              This permanently removes your account and signs you out. Your past
              contributions remain pseudonymized.
            </p>
            <form onSubmit={confirmDeletion}>
              <label htmlFor="delete-current-password">Current password</label>
              <input
                ref={deletePasswordInput}
                id="delete-current-password"
                autoComplete="current-password"
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                required
              />
              {deleteError && (
                <p className="form-message error" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="account-dialog-actions">
                <button
                  type="button"
                  className="button"
                  disabled={deletePending}
                  onClick={closeDeletion}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button danger"
                  disabled={deletePending}
                >
                  {deletePending ? "Deleting…" : "Confirm deletion"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
