## 1. Specification and tests

- [x] 1.1 Add production URL tests for `verify-full` success and weaker-mode rejection; confirm they fail before implementation.
- [x] 1.2 Add an executable image-trust test for the bundled CA and run it red against the current Dockerfiles.

## 2. Implementation

- [x] 2.1 Commit the verified public Supabase root PEM, copy it into all three production Node images, configure Node trust, and pass the image-trust test.
- [x] 2.2 Require `sslmode=verify-full` in production URL validation and pass focused config tests while leaving local mode unchanged.
- [x] 2.3 Update production env example and deployment guide with the secret-update/bootstrap sequence, then pass formatting checks.

## 3. Verification and delivery

- [x] 3.1 Run focused tests, production image builds/trust checks, Compose validation, lint/typecheck, and OpenSpec strict validation; record any live-VM limitation.
- [x] 3.2 Archive the OpenSpec change, run the no-mistakes gate, and deliver a one-commit draft PR with passing final CI.
