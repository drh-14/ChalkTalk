# Password recovery browser verification

Fresh Chromium run against the Vite frontend on October 16, 2026. The browser used mocked API responses (401 session restore; 400/204 reset), not a live API or database. The real reset API is unchanged by this PR.

- `reset-form.png`: two-password reset form.
- `length-error.png`: underlength password shows inline red error; no reset request sent.
- `mismatch-error.png`: confirmation mismatch shows inline red error; no reset request sent.
- `api-error.png`: API failure remains on the reset form.
- `success-sign-in.png`: API 204 redirects automatically to sign-in and shows the success notice.
- `mobile-form.png`: reset form at 390 × 700 px.

Browser assertions verified exactly two reset requests: one rejected response and one successful response; invalid submissions sent none.
