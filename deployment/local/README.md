# Local development deployment

Follow the [main README's local setup](../../README.md#start-locally) for configuration, startup, migration from older `.env` files, certificate trust, and explicit Piazza imports. The local Compose entry point is `deployment/local/compose.yml`.

The API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The local Compose file uses pgvector PostgreSQL and runs the vector migration on startup. Set `EMBEDDING_API_KEY` in the ignored `.env` to enable semantic matching; without a key, search remains lexical/fuzzy. The API, worker, collaboration server, and frontend each have a named local Dockerfile. API and worker images include qpdf, Poppler, Tesseract, and English OCR data. Back up an existing populated PostgreSQL volume before switching from the former `postgres:17-alpine` image.
