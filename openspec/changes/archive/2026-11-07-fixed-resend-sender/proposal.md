# Fix the Resend sender and simplify environment templates

## Why

ChalkTalk's verified sending domain is fixed, while the deployment templates still request a configurable `EMAIL_FROM`. The local template also lists nine rate-limit variables that application code no longer reads, and the production example uses an outdated subdomain.

## What Changes

Use a single code-owned Resend sender, remove the obsolete template entries, and set the production example domain to `joinchalktalk.com`. Keep the API key and supported endpoint/credential settings as environment variables.
