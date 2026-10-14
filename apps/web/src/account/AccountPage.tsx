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
  const [profile, setProfile] = useState<VersionedProfile>();
  const [loadError, setLoadError] = useState<string>();
  const [name, setName] = useState("");
  const [namePending, setNamePending] = useState(false);
  const [nameNotice, setNameNotice] = useState<string>();
  const [nameError, setNameError] = useState<string>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPasswordChange, setConfirmPasswordChange] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [currentPasswordError, setCurrentPasswordError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deletePasswordInput = useRef<HTMLInputElement>(null);
  const passwordTrigger = useRef<HTMLButtonElement>(null);
  const currentPasswordInput = useRef<HTMLInputElement>(null);

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
    if (confirmDelete) deletePasswordInput.current?.focus();
  }, [confirmDelete]);

  useEffect(() => {
    if (confirmPasswordChange) currentPasswordInput.current?.focus();
  }, [confirmPasswordChange]);

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
    setNameError(undefined);
    setNameNotice(undefined);
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setNameError(
        !trimmedName ? "Enter a display name" : "Use 1 to 100 characters",
      );
      return;
    }
    setNamePending(true);
    try {
      const updated = await updateDisplayName(
        trimmedName,
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
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError("Use 12 to 128 characters");
      return;
    }
    setConfirmPasswordChange(true);
  }

  async function confirmPasswordChangeSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!profile || passwordPending) return;
    if (!currentPassword) {
      setCurrentPasswordError("Enter your current password");
      return;
    }
    setPasswordPending(true);
    setCurrentPasswordError(undefined);
    try {
      await changePassword(
        currentPassword,
        newPassword,
        profile.etag,
        session.csrfToken,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "version_conflict")
        await refreshAfterConflict(setCurrentPasswordError);
      else setCurrentPasswordError(message(error));
      setPasswordPending(false);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPasswordChange(false);
    passwordTrigger.current?.focus();
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

  function closePasswordChange() {
    if (passwordPending) return;
    setConfirmPasswordChange(false);
    setCurrentPassword("");
    setCurrentPasswordError(undefined);
    passwordTrigger.current?.focus();
  }

  function closeDeletion() {
    if (deletePending) return;
    setConfirmDelete(false);
    setDeletePassword("");
    setDeleteError(undefined);
    requestAnimationFrame(() => deleteTrigger.current?.focus());
  }

  function handleDialogKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    onClose: () => void,
  ) {
    if (event.key === "Escape") {
      onClose();
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
    if (!deletePassword) {
      setDeleteError("Enter your current password");
      return;
    }
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
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(undefined);
                }}
                onBlur={() => {
                  if (!name.trim()) setNameError("Enter a display name");
                  else if (name.trim().length > 100)
                    setNameError("Use 1 to 100 characters");
                }}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "account-name-error" : undefined}
              />
              {nameError && (
                <p
                  id="account-name-error"
                  className="form-message error"
                  role="alert"
                >
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
                  (name.trim() === profile.data.displayName && !nameError)
                }
              >
                {namePending ? "Saving…" : "Save name"}
              </button>
            </form>
            <div className="account-password-settings">
              <h3 id="account-password-heading">Password</h3>
              <p>Use 12 to 128 characters for your new password.</p>
              <form onSubmit={savePassword}>
                <label htmlFor="account-new-password">New password</label>
                <input
                  id="account-new-password"
                  autoComplete="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setPasswordError(undefined);
                  }}
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={
                    passwordError ? "account-password-error" : undefined
                  }
                />
                {passwordError && (
                  <p
                    id="account-password-error"
                    className="form-message error"
                    role="alert"
                  >
                    {passwordError}
                  </p>
                )}
                {passwordNotice && (
                  <p className="form-message success" role="status">
                    {passwordNotice}
                  </p>
                )}
                <button
                  ref={passwordTrigger}
                  className="button primary"
                  type="submit"
                  disabled={passwordPending}
                >
                  {passwordPending ? "Changing…" : "Change password"}
                </button>
              </form>
            </div>
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
      {confirmPasswordChange && (
        <div className="account-dialog-backdrop">
          <div
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-title"
            onKeyDown={(event) =>
              handleDialogKeyDown(event, closePasswordChange)
            }
          >
            <h2 id="change-password-title">Confirm password change</h2>
            <p>Enter your current password to confirm this change.</p>
            <form onSubmit={confirmPasswordChangeSubmit}>
              <label htmlFor="account-current-password">Current password</label>
              <input
                ref={currentPasswordInput}
                id="account-current-password"
                autoComplete="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setCurrentPasswordError(undefined);
                }}
                aria-invalid={Boolean(currentPasswordError)}
                aria-describedby={
                  currentPasswordError
                    ? "account-current-password-error"
                    : undefined
                }
              />
              {currentPasswordError && (
                <p
                  id="account-current-password-error"
                  className="form-message error"
                  role="alert"
                >
                  {currentPasswordError}
                </p>
              )}
              <div className="account-dialog-actions">
                <button
                  type="button"
                  className="button"
                  disabled={passwordPending}
                  onClick={closePasswordChange}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={passwordPending}
                >
                  {passwordPending ? "Changing…" : "Confirm change"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="account-dialog-backdrop">
          <div
            className="account-dialog account-dialog-danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onKeyDown={(event) => handleDialogKeyDown(event, closeDeletion)}
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
                onChange={(event) => {
                  setDeletePassword(event.target.value);
                  setDeleteError(undefined);
                }}
                aria-invalid={Boolean(deleteError)}
                aria-describedby={
                  deleteError ? "delete-password-error" : undefined
                }
              />
              {deleteError && (
                <p
                  id="delete-password-error"
                  className="form-message error"
                  role="alert"
                >
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
