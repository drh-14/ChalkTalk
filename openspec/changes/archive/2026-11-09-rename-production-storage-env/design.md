# Design

## Approach

Use `NODE_ENV=production` as the existing mode selector. In that mode, `loadObjectStorageConfig` reads only the five `SUPABASE_STORAGE_*` variables, requires each, and retains the current HTTPS, Supabase host, project-reference, and credential checks. Outside production, it reads only `S3_*` as before. The resulting `S3ClientConfig` interface and file operations do not change.

Production Compose passes the new names unchanged into the API, worker, collaboration, and migration containers; the production env template and README use the same names. Local Compose and its template are unchanged. There is no legacy production alias, preventing a stale `S3_*` value from silently selecting a different bucket.

## Verification

Start with failing config tests for the new production names, the missing-value and legacy-name cases, and preserved local SeaweedFS behavior. Render production and local Compose through Docker's real Compose parser. Run focused tests, typecheck, lint, formatting, and the repository's no-mistakes gate before publishing a one-commit draft PR.
