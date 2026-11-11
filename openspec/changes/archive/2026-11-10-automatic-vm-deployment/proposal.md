# Automatic production deployment

## Why

Successful current `main` CI commits need a repeatable, pinned path to the prepared OVHcloud VM without granting untrusted CI runs production credentials.

## What Changes

- Post-CI GitHub Actions workflow and a VM-side serialized release script.
- Read-only schema, temporary private Storage, Resend, and public HTTPS smoke checks.
- Production operating instructions. No automatic database rollback or VM bootstrap changes beyond shared concurrency.
