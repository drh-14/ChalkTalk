# Design

Export the verified sender from API configuration constants. `loadEnvironment` uses it whenever Resend is selected, regardless of a legacy `EMAIL_FROM` value. The live-send guard uses the same constant. Existing frozen queued-message snapshots retain their sender, and retry validation still cancels if the selected sender changes. No database or public API contract changes are needed.

Remove obsolete template assignments and update setup instructions. Retain SMTP sender configuration for direct test/development paths; production remains Resend-only.
