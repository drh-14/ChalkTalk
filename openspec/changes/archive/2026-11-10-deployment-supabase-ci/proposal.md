# Disposable Supabase deployment integration check

## Why

The production deployment workflow has deterministic script tests but needs real API, PostgreSQL, and S3-protocol coverage before a commit is considered deployable. Production credentials and data must never be used by pull-request CI.

## What Changes

- Pin the Supabase CLI and start disposable local PostgreSQL and private Storage in CI.
- Run only the production API and migration containers against those services.
- Exercise real HTTP signup/login, course creation, resource upload/download, access denial, and failure behavior.
- Always stop containers and delete local data, even on a failed scenario.

Hosted Supabase, Resend, and VM smoke checks remain post-merge deployment checks.
