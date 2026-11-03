## 1. Configuration

- [x] 1.1 Write and run failing tests for strict local-mode flags and fail-fast remote PostgreSQL and S3 configuration.
- [x] 1.2 Implement mode validation using existing canonical connection settings, preserving local defaults.

## 2. Production topology

- [x] 2.1 Create and build separate named frontend, API, Hocuspocus collaboration and worker Dockerfiles; reuse API image for migrations.
- [x] 2.2 Update deployment Compose to remove local data services, enable Supabase egress and preserve startup order; set local flags in development Compose.
- [x] 2.3 Validate Compose rendering and production images; exercise relevant local database/storage integration tests.

## 3. Documentation and delivery

- [x] 3.1 Update deployment and root READMEs plus environment template for Supabase, Resend, startup, extension placement and limitations.
- [x] 3.2 Run local typecheck, tests, lint, format, image builds, and configuration checks. Document that the live Supabase smoke test is pending until a disposable project is available.
