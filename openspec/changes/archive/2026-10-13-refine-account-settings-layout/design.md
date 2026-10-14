## Context

The page currently uses two side-by-side cards and three inline password inputs. The authenticated password endpoint requires `currentPassword`, `newPassword`, and the profile ETag. The current account-deletion dialog already has focus handling and a short-viewport scroll limit.

## Goals / Non-Goals

**Goals:** Keep one visible new-password field in the page, preserve password reauthentication, and make field errors clear and accessible.

**Non-Goals:** Change the password API, account deletion semantics, or other account settings.

## Decisions

- Put name editing and password change in one Profile card, separated by a visible divider, with a narrower centered container and the Delete account card below. This gives the requested reading order at every width without a breakpoint-dependent grid.
- Validate the new password in the page before opening a dedicated current-password dialog. Reuse the existing password API only after confirmation. Keep the new password in memory when the dialog is canceled so the user can correct it.
- Associate each error with its input using `aria-describedby` and `aria-invalid`. Use inline red messages for client and server validation. The dialog traps focus, closes on Escape or Cancel when idle, and restores focus to the page trigger.

## Risks / Trade-offs

- The password is held in component state until submission or page exit. Clear both password values after a successful change and clear the current password when the dialog closes.
- Server errors can be less specific than local validation. Put wrong-current-password errors in the dialog and other password request failures beneath the new-password field or within the dialog as appropriate, without claiming success.
