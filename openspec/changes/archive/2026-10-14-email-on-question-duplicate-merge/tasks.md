## 1. Contract and failing tests

- [x] 1.1 Add PostgreSQL-backed merge API and worker tests for question confirmation, exact subject/body/link, queue idempotence, SMTP retry, stale jobs, and no-email cases; run them and confirm they fail for the expected missing behavior.

## 2. Notification implementation

- [x] 2.1 Enqueue one `send_question_duplicate_email` job in the successful question-confirmation transaction and verify the merge tests pass without changing response or ETag.
- [x] 2.2 Extend the jobs worker and server wiring to revalidate recipient/source/canonical access, compose plain-text email, retry SMTP failures, and mark stale jobs complete; verify worker tests pass.

## 3. Documentation and delivery

- [x] 3.1 Update the post API reference, OpenAPI description, and job behavior documentation; validate the OpenSpec change and run documentation checks.
- [x] 3.2 Run focused and repository tests, typecheck, lint, and a Mailpit delivery smoke test.
- [x] 3.3 Archive the OpenSpec change, commit the scoped work as one commit, run no-mistakes, resolve findings, and publish a one-commit draft PR with passing checks.
